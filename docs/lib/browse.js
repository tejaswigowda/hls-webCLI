// ── browse.js ──────────────────────────────────────────────────────────────────
// What a repository serves: every folder holding a master.m3u8, its files and size, its versions (tags <slug>/v<N>), and what its render.json says.
// Strata's Git tab browses a repository's files by their JSON; this lists the streams. Pure logic over the api of github.js, so it runs in the page and in tests.

import { releaseTags, parseTag, nextVersion, releaseBase, playerLink, CANONICAL_ORIGIN, isPinnedRef } from '../strata/releases.js';

const enc = p => String( p ).split( '/' ).map( encodeURIComponent ).join( '/' );

/** The tree's blobs grouped by the folder that holds a master.m3u8 ('' for the repository root). */
export function streamsOfTree( tree ) {

	const blobs = tree.filter( t => t.type === 'blob' );
	const roots = blobs.filter( b => b.path === 'master.m3u8' || b.path.endsWith( '/master.m3u8' ) ).map( b => b.path.slice( 0, - 'master.m3u8'.length ).replace( /\/$/, '' ) );
	// a folder inside another stream's folder (a nested master) is its own stream, so each file goes to the deepest root above it
	roots.sort( ( a, b ) => b.length - a.length );
	const out = new Map( roots.map( r => [ r, [] ] ) );
	for ( const b of blobs ) {

		const owner = roots.find( r => r === '' || b.path.startsWith( r + '/' ) );
		if ( owner !== undefined ) out.get( owner ).push( { path: owner === '' ? b.path : b.path.slice( owner.length + 1 ), bytes: b.size || 0 } );

	}
	return [ ...out.entries() ].map( ( [ slug, files ] ) => ( { slug, files } ) ).sort( ( a, b ) => a.slug < b.slug ? - 1 : 1 );

}

/** What a stream's files say about it, without reading any of them. */
export function describeFiles( files ) {

	const names = new Set( files.map( f => f.path ) );
	const rungs = [ ...new Set( files.filter( f => /^[^/]+\/index\.m3u8$/.test( f.path ) ).map( f => f.path.split( '/' )[ 0 ] ) ) ].filter( n => n !== 'audio' && n !== 'subs' );
	return {
		files: files.length, bytes: files.reduce( ( n, f ) => n + f.bytes, 0 ),
		rungs, hasAudio: names.has( 'audio/index.m3u8' ), hasPoster: [ ...names ].some( n => /^poster\.(jpe?g|png|webp)$/.test( n ) ),
		hasCaptions: [ ...names ].some( n => /\.vtt$/.test( n ) ), hasRenderJson: names.has( 'render.json' ), hasManifest: names.has( 'files.sha256' ),
	};

}

/** The few facts of a render.json a list needs; tolerant of any version-2 shape (a missing field is null, not an error). */
export function summariseRender( j ) {

	if ( ! j || typeof j !== 'object' ) return null;
	const r = j.render || {}, o = j.outputs || {}, p = j.publication || {};
	const tag = p.source ? p.source.tag : p.tag || null;
	return {
		version: j.version, tag, width: r.width || null, height: r.height || null, fps: r.fps || null, duration_s: r.duration_s || null, rendered_at: r.rendered_at || null,
		renditions: ( o.renditions || [] ).map( x => x.name ), audio: !! o.audio, captions: ( o.caption_tracks || [] ).map( t => t.language ),
		size_bytes: p.size_bytes === undefined ? null : p.size_bytes, mirrors: ( p.mirrors || ( p.url ? [ p.url ] : [] ) ).length, canonical: p.canonical || null,
		scene: j.scene ? `${ j.scene.repo }${ j.scene.file ? ' \u00b7 ' + j.scene.file : '' }` : null,
	};

}

async function allTags( api, repo ) {

	const names = [];
	for ( let page = 1; page < 50; page ++ ) {

		let refs;
		try { refs = await api.get( `/repos/${ repo }/git/matching-refs/tags/?per_page=100&page=${ page }` ); } catch ( e ) { if ( e.status === 409 ) return names; throw e; }   // 409: an empty repository
		if ( ! Array.isArray( refs ) ) break;
		for ( const r of refs ) names.push( { tag: String( r.ref ).replace( /^refs\/tags\//, '' ), sha: r.object && r.object.sha } );
		if ( refs.length < 100 ) break;

	}
	return names;

}

async function pool( items, size, fn ) {

	let next = 0;
	await Promise.all( Array.from( { length: Math.min( size, items.length ) }, async () => { while ( next < items.length ) { const i = next ++; await fn( items[ i ], i ); } } ) );

}

/**
 * @returns {{ repo, ref, branch, commit, truncated, streams: [{ slug, files, bytes, rungs, hasAudio, hasPoster, hasCaptions, hasRenderJson, hasManifest, versions: [{tag, version, sha}],
 *   latest: tag|null, serving: tag|null, state: 'current'|'ahead'|'behind'|'unversioned'|'untagged', render: object|null, renderError: string|null, base: string|null, player: string|null, nextVersion }] }}
 *   state: whether the folder as it is on the branch is the newest tagged version ('current'), older than it ('behind'), or has no tag to compare ('untagged', 'unversioned')
 */
export async function listStreams( api, { owner, repo, ref = null, playerRoot = CANONICAL_ORIGIN + '/player/' } ) {

	const full = `${ owner }/${ repo }`;
	const info = await api.get( `/repos/${ full }` );
	const branch = ref || info.default_branch;
	const tree = await api.get( `/repos/${ full }/git/trees/${ enc( branch ) }?recursive=1` );
	const tags = await allTags( api, full );
	const names = tags.map( t => t.tag );

	const streams = streamsOfTree( tree.tree || [] ).map( s => {

		const versions = releaseTags( names, s.slug ).map( t => ( { tag: t, version: parseTag( t ).version, sha: ( tags.find( x => x.tag === t ) || {} ).sha || null } ) );
		return { slug: s.slug, ...describeFiles( s.files ), versions, latest: versions[ 0 ] ? versions[ 0 ].tag : null, serving: null, state: 'untagged', render: null, renderError: null, base: null, player: null };

	} );

	await pool( streams, 6, async s => {

		if ( ! s.hasRenderJson ) { s.renderError = 'no render.json'; return; }
		try {

			const bytes = await api.getBytes( `/repos/${ full }/contents/${ enc( s.slug ? s.slug + '/' : '' ) }render.json?ref=${ encodeURIComponent( branch ) }` );
			s.render = summariseRender( JSON.parse( new TextDecoder().decode( bytes ) ) );

		} catch ( e ) { s.renderError = String( e.message ).slice( 0, 160 ); }

	} );

	for ( const s of streams ) {

		s.serving = s.render && s.render.tag ? s.render.tag : null;
		const latest = s.versions[ 0 ];
		if ( ! latest ) s.state = 'untagged';
		else if ( ! s.serving ) s.state = 'unversioned';
		else if ( s.serving === latest.tag ) s.state = 'current';
		else { const p = parseTag( s.serving ); s.state = p && p.version > latest.version ? 'ahead' : 'behind'; }
		const pin = s.serving && isPinnedRef( s.serving ) ? s.serving : s.latest;
		// a share link must be pinned to a tag: a stream with no tag has no address that stays the same
		if ( pin && s.slug ) { s.base = releaseBase( { repo: full, tag: pin, slug: s.slug } ); s.player = playerLink( playerRoot, s.base ); }
		s.nextVersion = s.slug ? nextVersion( names, s.slug ) : null;

	}
	return { repo: full, ref: branch, branch, commit: tree.sha, truncated: !! tree.truncated, streams };

}
