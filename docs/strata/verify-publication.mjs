#!/usr/bin/env node
// verify-publication: does every place a render is published hold the bytes that were published? (guides/CDN_INDEPENDENCE.md, gates G5 and G7)
//
//   node tools/verify-publication.mjs <render folder address> [--require N]
//
// Reads the render's render.json, lists where it lives (publication.canonical, then publication.mirrors; a legacy publication has just its one pinned location),
// and checks every file of each location against that location's own files.sha256. A location that is missing files, serves other bytes, or serves no manifest
// is reported as such, and is not counted as verified. Exit 0 when at least N locations verify (default: all of them).
//
// A manifest vouches only for itself: so the manifest of each location is also compared with the first location's, and a mirror whose manifest differs is reported.
import { publicationOf } from './releases.js';
import { verifyBase, MANIFEST_NAME } from './filesManifest.js';

export async function nodeFetchBytes( url, { timeoutMs = 60000 } = {} ) {

	const res = await fetch( url, { signal: AbortSignal.timeout( timeoutMs ), headers: { 'cache-control': 'no-cache' } } );
	if ( ! res.ok ) throw Object.assign( new Error( `HTTP ${ res.status }` ), { status: res.status } );
	return new Uint8Array( await res.arrayBuffer() );

}

/**
 * @returns {{ locations: { base, verdict: 'verified'|'unverifiable'|'incomplete'|'different', detail, result }[], verified: number, ok: boolean }}
 */
export async function verifyPublication( base, { fetchBytes = nodeFetchBytes, require = null, onProgress = () => {}, ...retry } = {} ) {

	const root = base.replace( /\/*$/, '/' );
	let json = null, bases = [ root ];
	try {

		json = JSON.parse( new TextDecoder().decode( await fetchBytes( root + 'render.json' ) ) );
		const pub = publicationOf( json );
		bases = [ ...new Set( [ root, ...( pub.canonical ? [ pub.canonical ] : [] ), ...pub.mirrors ] ) ];

	} catch ( e ) { /* no render.json: the one address given is all there is to check */ }

	let first = null;
	const locations = [];
	for ( const b of bases ) {

		const result = await verifyBase( b, { fetchBytes, ...retry, onProgress: ( n, total ) => onProgress( b, n, total ) } );
		let manifestText = null;
		if ( result.manifest ) try { manifestText = new TextDecoder().decode( await fetchBytes( b + MANIFEST_NAME ) ); } catch ( e ) { /* just read it a moment ago */ }
		let verdict, detail;
		if ( ! result.manifest ) { verdict = 'unverifiable'; detail = result.errors[ 0 ]; } else if ( result.missing.length || result.mismatched.length || result.errors.length ) {

			verdict = result.mismatched.length ? 'different' : 'incomplete';
			detail = [ result.missing.length ? `${ result.missing.length } missing (${ result.missing.slice( 0, 3 ).join( ', ' ) }${ result.missing.length > 3 ? ', …' : '' })` : '', result.mismatched.length ? `${ result.mismatched.length } with other bytes (${ result.mismatched.slice( 0, 3 ).join( ', ' ) })` : '', ...result.errors ].filter( Boolean ).join( '; ' );

		} else if ( first !== null && manifestText !== first ) { verdict = 'different'; detail = 'its files.sha256 is not the first location\u2019s'; } else { verdict = 'verified'; detail = `${ result.checked } files${ result.flaky.length ? `; ${ result.flaky.length } needed a retry (${ result.flaky.slice( 0, 3 ).map( f => f.path ).join( ', ' ) }${ result.flaky.length > 3 ? ', …' : '' }): this host is unreliable` : '' }`; }
		if ( first === null && manifestText !== null ) first = manifestText;
		locations.push( { base: b, verdict, detail, result } );

	}
	const verified = locations.filter( l => l.verdict === 'verified' ).length;
	return { locations, verified, ok: verified >= ( require === null ? locations.length : require ) };

}

// hls-webcli patch: `process` does not exist in a page, where this module is imported for verifyPublication()
if ( typeof process !== 'undefined' && import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const args = process.argv.slice( 2 );
	const i = args.indexOf( '--require' );
	const require = i >= 0 ? Number( args.splice( i, 2 )[ 1 ] ) : null;
	if ( ! args[ 0 ] ) { console.error( 'usage: verify-publication.mjs <render folder address> [--require N]' ); process.exit( 2 ); }
	const r = await verifyPublication( args[ 0 ], { require } );
	for ( const l of r.locations ) console.log( `${ l.verdict.padEnd( 12 ) } ${ l.base}  ${ l.detail }` );
	console.log( `${ r.verified } of ${ r.locations.length } locations verified${ require === null ? '' : ` (needed ${ require })` }.` );
	process.exit( r.ok ? 0 : 1 );

}
