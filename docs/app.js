import { githubApi, parseRepoUrl, trackedFetchBytes } from './lib/github.js';
import { createLedger } from './lib/ledger.js';
import { listStreams } from './lib/browse.js';
import { inspectVideo } from './lib/ingest.js';
import { prepareUpload, describePublish, publishPrepared, slugFromFilename, RefusedError } from './lib/prepare.js';
import { makeZip } from './lib/zip.js';
import { planLadder } from './strata/publishSet.js';
import { transcodeLadder } from './strata/ladder.js';
import { buildAudioRendition, aacSupport } from './strata/audio.js';
import { verifyPublication } from './strata/verify-publication.mjs';
import { parseManifest } from './strata/filesManifest.js';
import { formatBytes } from './strata/renderJson.js';

const $ = id => document.getElementById( id );
const ledger = createLedger( window.localStorage );

function el( tag, props = {}, ...kids ) {

	const n = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( props ) ) { if ( k === 'class' ) n.className = v; else if ( k === 'text' ) n.textContent = v; else n.setAttribute( k, v ); }
	for ( const kid of kids ) n.append( kid );
	return n;

}

/** An <a> only for an https address: nothing read from a repository becomes a javascript: or data: link. */
function link( href, text ) {

	const a = el( 'a', { text } );
	if ( /^https:\/\//.test( href ) ) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
	return a;

}

// ── the ledger ────────────────────────────────────────────────────────────────
function showLedger() {

	const t = ledger.totals(), box = $( 'ledger' );
	box.textContent = '';
	const sent = el( 'b', { class: t.bytesSent ? 'sent' : '', text: formatBytes( t.bytesSent ) } );
	box.append( 'uploaded ', sent, ` in ${ t.writes } request${ t.writes === 1 ? '' : 's' } \u00b7 read ${ t.reads } (${ formatBytes( t.bytesRead ) })` );

}
ledger.onChange( showLedger );
showLedger();

// ── token and who it is ───────────────────────────────────────────────────────
const tokenBox = $( 'token' );
tokenBox.value = sessionStorage.getItem( 'hls-webcli:token' ) || '';
let login = null;
const api = ( opts = {} ) => githubApi( { token: tokenBox.value.trim() || null, ledger, ...opts } );

async function whoAmI() {

	login = null;
	$( 'who' ).textContent = '';
	if ( ! tokenBox.value.trim() ) return null;
	try { login = ( await api().get( '/user', { purpose: 'identify' } ) ).login; $( 'who' ).textContent = `publishing as @${ login }`; } catch ( e ) { $( 'who' ).textContent = 'that token was not accepted'; }
	return login;

}
tokenBox.addEventListener( 'change', () => { sessionStorage.setItem( 'hls-webcli:token', tokenBox.value.trim() ); whoAmI(); } );
if ( tokenBox.value ) whoAmI();

// ── tabs ──────────────────────────────────────────────────────────────────────
function tab( name ) {

	for ( const t of [ 'library', 'upload' ] ) { $( t ).hidden = t !== name; $( 'tab-' + t ).classList.toggle( 'on', t === name ); }

}
$( 'tab-library' ).onclick = () => tab( 'library' );
$( 'tab-upload' ).onclick = () => tab( 'upload' );

// ── Library ───────────────────────────────────────────────────────────────────
const setLibStatus = ( text, cls = '' ) => { const s = $( 'library-status' ); s.textContent = text; s.className = 'status ' + cls; };

async function showLibrary( input ) {

	const parsed = parseRepoUrl( input );
	if ( ! parsed ) { setLibStatus( 'Enter a repository as github.com/owner/name or owner/name.', 'bad' ); return; }
	setLibStatus( `Listing ${ parsed.owner }/${ parsed.repo }\u2026` );
	$( 'library-result' ).textContent = '';
	try {

		const lib = await listStreams( api(), parsed );
		history.replaceState( null, '', `#repo=${ lib.repo }` );
		setLibStatus( `${ lib.streams.length } stream${ lib.streams.length === 1 ? '' : 's' } in ${ lib.repo } (${ lib.branch } @ ${ lib.commit.slice( 0, 7 ) })` + ( lib.truncated ? ' \u2014 GitHub truncated the file list, so some streams may be missing' : '' ), lib.truncated ? 'bad' : '' );
		$( 'library-result' ).append( libraryTable( lib ) );

	} catch ( e ) {

		setLibStatus( /404/.test( e.message ) ? `${ parsed.owner }/${ parsed.repo } was not found (or is private: add a token).` : e.message.slice( 0, 300 ), 'bad' );

	}

}

function libraryTable( lib ) {

	const table = el( 'table' );
	table.append( el( 'thead', {}, el( 'tr', {}, ...[ 'Stream', 'Serving', 'Versions', 'Size', 'Has', '' ].map( h => el( 'th', { text: h } ) ) ) ) );
	const body = el( 'tbody' );
	for ( const s of lib.streams ) {

		const verdicts = el( 'div', { class: 'verdicts' } );
		const name = s.slug || '(repository root)';
		const serving = el( 'td' );
		serving.append( el( 'span', { class: 'badge ' + s.state, text: s.state } ), ' ', s.serving || '' );
		if ( s.renderError ) serving.append( el( 'div', { class: 'note', text: s.renderError } ) );
		else if ( s.render ) serving.append( el( 'div', { class: 'note', text: [ s.render.width && `${ s.render.width }\u00d7${ s.render.height }`, s.render.fps && `${ s.render.fps } fps`, s.render.duration_s && `${ Math.round( s.render.duration_s ) } s` ].filter( Boolean ).join( ' \u00b7 ' ) } ) );
		const versions = el( 'td', { class: 'chips' } );
		for ( const v of s.versions ) versions.append( link( `https://github.com/${ lib.repo }/tree/${ v.tag }`, 'v' + v.version ) );
		if ( ! s.versions.length ) versions.append( el( 'span', { class: 'note', text: 'no tags' } ) );
		const has = [ s.rungs.join(' '), s.hasAudio && 'audio', s.hasCaptions && 'captions', s.hasPoster && 'poster', s.hasManifest ? 'files.sha256' : 'no files.sha256' ].filter( Boolean ).join( ' \u00b7 ' );
		const actions = el( 'td' );
		if ( s.player ) actions.append( link( s.player, 'Play' ), ' ' );
		if ( s.base ) {

			const verify = el( 'button', { type: 'button', text: 'Verify' } );
			verify.onclick = async () => {

				verify.disabled = true; verdicts.textContent = 'Checking every file against files.sha256\u2026';
				try {

					const r = await verifyPublication( s.base, { fetchBytes: trackedFetchBytes( { ledger } ), onProgress: ( b, n, total ) => { verdicts.textContent = `${ new URL( b ).host }: ${ n }/${ total }`; } } );
					verdicts.textContent = '';
					for ( const l of r.locations ) verdicts.append( el( 'div', { class: l.verdict, text: `${ l.verdict.padEnd( 12 ) } ${ l.base }  ${ l.detail || '' }` } ) );
					verdicts.append( el( 'div', { text: `${ r.verified } of ${ r.locations.length } locations verified.` } ) );

				} catch ( e ) { verdicts.textContent = 'Could not verify: ' + e.message; }
				verify.disabled = false;

			};
			actions.append( verify, ' ' );

		}
		const next = el( 'button', { type: 'button', text: s.nextVersion ? `New v${ s.nextVersion }` : 'New' } );
		next.onclick = () => { $( 'dest-repo' ).value = lib.repo; $( 'dest-branch' ).value = lib.branch; $( 'dest-slug' ).value = s.slug; tab( 'upload' ); };
		actions.append( next );
		const first = el( 'td' );
		first.append( el( 'strong', { text: name } ), verdicts );
		body.append( el( 'tr', {}, first, serving, versions, el( 'td', { text: formatBytes( s.bytes ) } ), el( 'td', { class: 'note', text: has } ), actions ) );

	}
	table.append( body );
	return table;

}

$( 'library-form' ).addEventListener( 'submit', e => { e.preventDefault(); showLibrary( $( 'repo-url' ).value ); } );

// ── Upload & publish ──────────────────────────────────────────────────────────
let current = null;            // { name, bytes, seen }
let prepared = null;
let cancelRequested = false;
let zipUrl = null;

const setStatus = ( text, cls = '' ) => { const s = $( 'upload-status' ); s.textContent = text; s.className = 'status ' + cls; };
const setProgress = f => { const p = $( 'progress' ); p.hidden = f === null; if ( f !== null ) p.value = f; };

function fail( code, error ) { window.__webcli_result = Object.freeze( { ok: false, code, error } ); }

async function chooseVideo( file ) {

	prepared = null; $( 'review' ).hidden = true; $( 'upload-form' ).hidden = true; setStatus( '' );
	const box = $( 'analysis' );
	box.textContent = `Reading ${ file.name }\u2026`; box.className = 'status';
	const bytes = new Uint8Array( await file.arrayBuffer() );
	const seen = inspectVideo( bytes );
	box.textContent = '';
	if ( ! seen.ok ) {

		const r = seen.wouldRefuse;
		box.append( el( 'div', { class: 'refusal' }, el( 'code', { text: r.reason } ), ': ' + r.detail ) );
		fail( r.reason, r.detail );
		current = null;
		return;

	}
	current = { name: file.name, bytes, seen };
	const i = seen.info;
	box.append( `${ file.name }: ${ i.width }\u00d7${ i.height } at ${ i.fps } fps, ${ i.frames } frames (${ ( i.frames / i.fps ).toFixed( 1 ) } s), ${ i.codec }, ${ i.keyframes } keyframe${ i.keyframes === 1 ? '' : 's' }${ i.reordered ? ', B-frames' : '' }, ${ seen.hasAudio ? 'with audio' : 'no audio' }, ${ formatBytes( bytes.length ) }.` );
	$( 'upload-form' ).hidden = false;
	if ( ! $( 'dest-slug' ).value || $( 'dest-slug' ).dataset.auto === '1' ) { $( 'dest-slug' ).value = slugFromFilename( file.name ); $( 'dest-slug' ).dataset.auto = '1'; }
	$( 'dest-slug' ).oninput = () => { $( 'dest-slug' ).dataset.auto = '0'; };
	const rungs = $( 'rungs' );
	rungs.textContent = '';
	for ( const r of planLadder( { width: i.width, height: i.height, fps: i.fps } ) ) {

		const box = el( 'input', { type: 'checkbox', checked: '', 'data-height': String( r.height ) } );
		rungs.append( el( 'label', {}, box, ` ${ r.name } (${ r.width }\u00d7${ r.height }, ${ r.kbps } kbps)  ` ) );

	}
	$( 'audio-row' ).hidden = ! seen.hasAudio;

}

$( 'video' ).addEventListener( 'change', e => { if ( e.target.files[ 0 ] ) chooseVideo( e.target.files[ 0 ] ); } );
const drop = $( 'drop' );
drop.addEventListener( 'dragover', e => { e.preventDefault(); drop.classList.add( 'over' ); } );
drop.addEventListener( 'dragleave', () => drop.classList.remove( 'over' ) );
drop.addEventListener( 'drop', e => { e.preventDefault(); drop.classList.remove( 'over' ); if ( e.dataTransfer.files[ 0 ] ) chooseVideo( e.dataTransfer.files[ 0 ] ); } );

$( 'upload-form' ).addEventListener( 'submit', async e => {

	e.preventDefault();
	if ( ! current ) return;
	prepared = null; $( 'review' ).hidden = true; $( 'receipt' ).hidden = true; $( 'confirm' ).hidden = true;
	const keep = [ ...$( 'rungs' ).querySelectorAll( 'input' ) ].filter( b => b.checked ).map( b => Number( b.dataset.height ) );
	const vttFile = $( 'vtt' ).files[ 0 ];
	$( 'prepare' ).disabled = true; $( 'cancel' ).hidden = false; cancelRequested = false;
	try {

		const result = await prepareUpload( {
			file: current, slug: $( 'dest-slug' ).value.trim(), repo: $( 'dest-repo' ).value.trim(), branch: $( 'dest-branch' ).value.trim() || 'main',
			keep, audio: $( 'audio-keep' ).checked ? 'keep' : 'drop', canonical: $( 'canonical' ).checked,
			captions: vttFile ? { text: await vttFile.text(), language: $( 'vtt-lang' ).value.trim() || 'en' } : null,
			api: api(), deps: { transcodeLadder, buildAudioRendition, aacSupport },
			onProgress: ( f, text ) => { setProgress( f ); setStatus( text ); }, shouldCancel: () => cancelRequested,
		} );
		if ( ! result ) { setStatus( 'Cancelled.' ); setProgress( null ); return; }
		prepared = result;
		showReview( result );

	} catch ( err ) {

		setProgress( null );
		const code = err instanceof RefusedError ? err.reason : err.code || 'error';
		setStatus( ( err instanceof RefusedError ? `Refused (${ err.reason }): ` : '' ) + ( err.message || String( err ) ), 'bad' );
		fail( code, err.message || String( err ) );

	} finally { $( 'prepare' ).disabled = false; $( 'cancel' ).hidden = true; }

} );
$( 'cancel' ).onclick = () => { cancelRequested = true; };

function showReview( p ) {

	setProgress( null );
	setStatus( '' );
	$( 'review' ).hidden = false;
	const j = p.renderJson;
	const sum = $( 'review-summary' );
	sum.textContent = `${ p.plan.tag } \u2014 ${ j.outputs.renditions.map( r => r.name ).join( ', ' ) }${ j.outputs.audio ? ', audio' : '' }${ j.outputs.caption_tracks.length ? ', captions' : '' }; ${ p.set.files.length } files, ${ formatBytes( p.set.total ) } (${ p.plan.version > 1 ? `the next version after v${ p.plan.version - 1 }` : 'the first version' }).`;
	const gate = $( 'gate' );
	gate.textContent = '';
	if ( p.gate.ok ) gate.append( el( 'div', { class: 'pass', text: '\u2713 Every check passed.' } ) );
	else for ( const f of p.gate.failures ) gate.append( el( 'div', { class: 'fail', text: 'REFUSED: ' + f } ) );
	for ( const w of p.set.warnings ) gate.append( el( 'div', { class: 'note', text: w } ) );
	$( 'tree-summary' ).textContent = `Files (${ p.set.tree.length })`;
	$( 'tree' ).textContent = p.set.tree.map( t => `${ String( t.bytes ).padStart( 10 ) }  ${ t.path }` ).join( '\n' );
	$( 'publish' ).disabled = ! p.gate.ok;
	$( 'download' ).disabled = false;

	// the result is the same whether the set is then downloaded or published: published copies nothing back into it
	const zip = makeZip( p.set.files );
	if ( zipUrl ) URL.revokeObjectURL( zipUrl );
	zipUrl = URL.createObjectURL( new Blob( [ zip ], { type: 'application/zip' } ) );
	const manifest = parseManifest( new TextDecoder().decode( p.set.files.find( f => f.path.endsWith( '/files.sha256' ) ).bytes ) ).entries;
	window.__webcli_result = Object.freeze( {
		ok: true, filename: `${ p.slug }-v${ p.plan.version }.zip`, size: zip.length, bytes: zip, blobUrl: zipUrl, slug: p.slug, tag: p.plan.tag, version: p.plan.version,
		files: Object.freeze( p.set.files.map( f => Object.freeze( { path: f.path, bytes: f.bytes.length, sha256: manifest.get( f.path.slice( p.slug.length + 1 ) ) || null } ) ) ),
		renderJson: Object.freeze( j ), gate: Object.freeze( p.gate ),
	} );

}

$( 'download' ).onclick = () => {

	const r = window.__webcli_result;
	if ( ! r || ! r.ok ) return;
	const a = el( 'a', { href: r.blobUrl, download: r.filename } );
	document.body.append( a ); a.click(); a.remove();

};

// Publishing is its own step: show what will be sent, where and as whom, then send it.
$( 'publish' ).onclick = async () => {

	if ( ! prepared || ! prepared.gate.ok ) return;
	if ( ! tokenBox.value.trim() ) { setStatus( 'Publishing needs a GitHub token (top of the page).', 'bad' ); return; }
	await whoAmI();
	if ( ! login ) { setStatus( 'The token was not accepted by GitHub.', 'bad' ); return; }
	const d = describePublish( prepared, { user: login } );
	$( 'confirm-text' ).textContent = `This will send ${ d.text }.` + ( d.needsInit ? ' The repository has no commits yet; a README will be added first.' : '' );
	$( 'confirm' ).hidden = false;

};
$( 'confirm-no' ).onclick = () => { $( 'confirm' ).hidden = true; };
$( 'confirm-yes' ).onclick = async () => {

	$( 'confirm' ).hidden = true;
	$( 'publish' ).disabled = true;
	try {

		const receipt = await publishPrepared( api( { onWait: s => setStatus( `GitHub rate limit \u2014 retrying in ${ s }s\u2026` ) } ), prepared, { onProgress: ( f, text ) => { setProgress( f ); setStatus( text ); } } );
		setProgress( null ); setStatus( '' );
		window.__webcli_receipt = Object.freeze( { ok: true, ...receipt, as: login } );
		const box = $( 'receipt' );
		box.hidden = false; box.textContent = '';
		box.append( el( 'strong', { text: `\u2713 Published ${ receipt.tag }` } ), el( 'div', { text: `${ receipt.files } files, ${ formatBytes( receipt.bytes ) } to ${ receipt.repo } (${ receipt.branch }) as @${ login } at ${ receipt.at }` } ),
			el( 'div', {}, 'commit ', link( `https://github.com/${ receipt.repo }/commit/${ receipt.commit }`, receipt.commit.slice( 0, 12 ) ), ' \u00b7 tag ', link( `https://github.com/${ receipt.repo }/tree/${ receipt.tag }`, receipt.tag ), ' \u00b7 ', link( receipt.player, 'play' ) ),
			el( 'div', { class: 'note', text: `files.sha256 ${ receipt.files_sha256 }` } ) );

	} catch ( err ) {

		setProgress( null );
		setStatus( 'Publish failed, nothing was published: ' + ( err.message || err ), 'bad' );
		$( 'publish' ).disabled = false;

	}

};

// A link such as #repo=owner/name lists that repository when the page opens.
const fromHash = new URLSearchParams( location.hash.slice( 1 ) );
if ( fromHash.get( 'repo' ) ) { $( 'repo-url' ).value = fromHash.get( 'repo' ); showLibrary( fromHash.get( 'repo' ) ); }
if ( fromHash.get( 'tab' ) === 'upload' ) tab( 'upload' );
