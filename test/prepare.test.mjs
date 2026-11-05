import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { prepareUpload, publishPrepared, describePublish, RefusedError, slugFromFilename } from '../docs/lib/prepare.js';
import { githubApi } from '../docs/lib/github.js';
import { createLedger } from '../docs/lib/ledger.js';
import { listStreams } from '../docs/lib/browse.js';
import { makeZip } from '../docs/lib/zip.js';
import { packageRendition } from '../docs/strata/fmp4.js';
import { packageAudio } from '../docs/strata/audio.js';
import { planLadder } from '../docs/strata/publishSet.js';
import { verifyBase } from '../docs/strata/filesManifest.js';
import { validateRenderJson } from '../docs/strata/renderJson.js';
import { ReleaseError } from '../docs/strata/releases.js';
import { MockGitHub } from './mock-github.mjs';
import { HAS_FFMPEG, fixture, fixtureDir } from './fixtures.mjs';

const skip = HAS_FFMPEG ? false : 'no ffmpeg on this machine to make fixtures';
const schema = JSON.parse( readFileSync( new URL( '../docs/strata/render.schema.json', import.meta.url ) ) );
const ajv = addFormats( new Ajv( { strict: false, allErrors: true } ) );
const validateSchema = ajv.compile( schema );

// The browser's encoder is replaced by one that repackages the upload's own samples: the segmenter, playlists, manifest and release code are the real ones.
const fakeDeps = {
	aacSupport: async () => ( { ok: true, reason: '' } ),
	transcodeLadder: async ( { master, ladder } ) => ( {
		rungs: ladder.map( rung => ( {
			rung, packaged: packageRendition( { width: master.width, height: master.height, fps: master.fps, avcC: master.avcC, samples: master.samples, keyframes: master.keyframes } ),
			encoder: { kind: 'software', name: 'fake', version: null, settings_hash: 'sha256:' + '0'.repeat( 64 ), threads: null, config: { codec: 'avc1', width: rung.width, height: rung.height, bitrate: rung.kbps * 1000, framerate: master.fps, keyEvery: master.fps * 2 }, stage: 'ladder', input: 'master' },
		} ) ),
		poster: new Uint8Array( [ 0xff, 0xd8, 0xff, 0xd9 ] ),
	} ),
	buildAudioRendition: async ( { durationSeconds, videoStartsSeconds } ) => {

		const n = Math.ceil( durationSeconds * 48000 / 1024 );
		const frames = Array.from( { length: n }, ( _, i ) => new Uint8Array( 100 ).fill( i & 255 ) );
		return { packaged: packageAudio( { frames, asc: new Uint8Array( [ 0x11, 0x90 ] ), videoStartsSeconds } ), delaySamples: 2112 };

	},
};

const now = () => new Date( '2026-11-04T22:00:00Z' );
const VTT = 'WEBVTT\n\nintro\n00:00:00.500 --> 00:00:02.000\nHello there\n\nsecond\n00:00:02.500 --> 00:00:04.000\nSecond line\n';

function setup() {

	const gh = new MockGitHub();
	const ledger = createLedger();
	const api = githubApi( { token: 'tok', fetch: gh.fetch, ledger, wait: async () => {} } );
	return { gh, ledger, api };

}

const upload = ( name = 'My Clip.mp4', bytes = fixture( 'cfr30' ) ) => ( { name, bytes } );

test( 'an upload becomes a publish set that passes Strata\u2019s own gate and its published schema', { skip }, async () => {

	const { api } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, captions: { text: VTT, language: 'en' }, now } );
	assert.equal( p.gate.ok, true, p.gate.failures.join( '; ' ) );
	const paths = p.set.files.map( f => f.path ).sort();
	for ( const need of [ 'render.json', 'files.sha256', 'master.m3u8', 'poster.jpg', 'captions.vtt', 'subs/en/index.m3u8', '240p30/index.m3u8' ].filter( x => ! x.startsWith( '240' ) ) ) assert.ok( paths.includes( 'my-clip/' + need ), need );
	assert.ok( paths.some( x => x.endsWith( '/init.mp4' ) ) && paths.some( x => x.endsWith( '/seg00001.m4s' ) ) );
	assert.deepEqual( validateRenderJson( p.renderJson ), [] );
	assert.equal( validateSchema( p.renderJson ), true, JSON.stringify( validateSchema.errors ) );
	assert.equal( p.renderJson.publication.tag, 'my-clip/v1' );
	assert.equal( p.renderJson.scene.file, 'My Clip.mp4' );
	assert.match( p.renderJson.scene.hash, /^sha256:[0-9a-f]{64}$/ );

} );

test( 'it claims nothing it did not do: no time-source audit, no deterministic frames', { skip }, async () => {

	const { api } = setup();
	const j = ( await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } ) ).renderJson;
	assert.equal( j.render.time_source_audit.passed, false );
	assert.deepEqual( j.render.time_source_audit.confirmed, [] );
	assert.equal( j.render.determinism.frames, false );
	assert.ok( j.render.determinism.reasons.frames.some( r => /time-source audit/.test( r ) ) );
	assert.equal( j.outputs.audio_present, true );
	assert.equal( j.outputs.audio.encoder_delay_samples, 2112 );

} );

test( 'the master lists the audio codec in every variant and an audio group; captions add a subtitle group', { skip }, async () => {

	const { api } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, captions: { text: VTT, language: 'en' }, now } );
	const master = new TextDecoder().decode( p.set.files.find( f => f.path === 'my-clip/master.m3u8' ).bytes );
	const variants = master.split( '\n' ).filter( l => l.startsWith( '#EXT-X-STREAM-INF' ) );
	assert.ok( variants.length >= 1 );
	for ( const v of variants ) { assert.match( v, /CODECS="avc1\.[0-9a-f]{6},mp4a\.40\.2"/ ); assert.match( v, /AUDIO="aud"/ ); assert.match( v, /SUBTITLES="subs"/ ); }
	assert.match( master, /#EXT-X-MEDIA:TYPE=AUDIO/ );
	assert.match( master, /#EXT-X-MEDIA:TYPE=SUBTITLES/ );
	const track = p.renderJson.outputs.caption_tracks[ 0 ];
	assert.equal( track.cue_count, 2 ); assert.equal( track.addressable, true ); assert.equal( track.source, 'manual' ); assert.equal( track.hls, 'subs/en/index.m3u8' );

} );

test( 'a ladder keeps whole GOPs per segment and the init segment is declared for every rendition', { skip }, async () => {

	const { api } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, audio: 'drop', now } );
	const text = path => new TextDecoder().decode( p.set.files.find( f => f.path === 'my-clip/' + path ).bytes );
	const rung = p.renderJson.outputs.renditions[ 0 ];
	const pl = text( rung.playlist );
	assert.match( pl, /#EXT-X-MAP:URI="init\.mp4"/ );
	assert.deepEqual( [ ...pl.matchAll( /#EXTINF:([\d.]+)/g ) ].map( m => Number( m[ 1 ] ) ), [ 6, 2 ], '8 s at 30 fps with a keyframe every 2 s: 6 s and 2 s' );
	assert.equal( p.renderJson.outputs.audio, null );
	assert.match( p.renderJson.outputs.audio_absence, /dropped/ );

} );

test( 'a video that would be refused is refused before anything is read from the repository', { skip }, async () => {

	const { api, gh } = setup();
	await assert.rejects( prepareUpload( { file: upload( 'v.mp4', fixture( 'vfr' ) ), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps } ), e => e instanceof RefusedError && e.reason === 'vfr-input' );
	assert.equal( gh.requests.length, 0 );

} );

test( 'a bad name stops the prepare, with the rule', { skip }, async () => {

	const { api } = setup();
	await assert.rejects( prepareUpload( { file: upload(), slug: 'test', repo: 'me/renders', api, deps: fakeDeps } ), e => e instanceof ReleaseError && /category/.test( e.message ) );
	assert.equal( slugFromFilename( 'My Clip (final).MP4' ), 'my-clip-final' );

} );

test( 'publishing commits one tagged release, and what is served verifies against its own files.sha256', { skip }, async () => {

	const { api, gh, ledger } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } );
	assert.equal( ledger.totals().bytesSent, 0, 'preparing sends nothing' );
	const d = describePublish( p, { user: 'me' } );
	assert.match( d.text, /^\d+ files, .+ to github\.com\/me\/renders \(main\) as my-clip\/v1, as @me$/ );
	const commitsBefore = gh.commits.size;
	const r = await publishPrepared( api, p, { now } );
	assert.equal( r.tag, 'my-clip/v1' );
	assert.equal( gh.commits.size, commitsBefore + 1, 'one commit' );
	assert.equal( gh.refs.get( 'tags/my-clip/v1' ), r.commit );
	assert.match( r.player, /#https:\/\/cdn\.jsdelivr\.net\/gh\/me\/renders@my-clip\/v1\/my-clip\/$/ );
	assert.match( r.files_sha256, /^sha256:[0-9a-f]{64}$/ );
	assert.ok( ledger.totals().bytesSent > p.set.files.reduce( ( n, f ) => n + f.bytes.length, 0 ), 'the ledger counts what was sent' );

	const served = gh.files( 'my-clip/v1' );
	const result = await verifyBase( 'https://x/', { fetchBytes: async url => { const b = served.get( 'my-clip/' + url.replace( 'https://x/', '' ) ); if ( ! b ) throw Object.assign( new Error( 'HTTP 404' ), { status: 404 } ); return b; }, attempts: 1 } );
	assert.equal( result.ok, true, JSON.stringify( result ) );
	assert.ok( result.checked > 5 );

} );

test( 'a second publish is the next version; the old tag stays; the Library lists both', { skip }, async () => {

	const { api, gh } = setup();
	const mk = () => prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } );
	const r1 = await publishPrepared( api, await mk(), { now } );
	const r2 = await publishPrepared( api, await mk(), { now } );
	assert.equal( r2.tag, 'my-clip/v2' );
	assert.equal( gh.refs.get( 'tags/my-clip/v1' ), r1.commit, 'v1 did not move' );
	const lib = await listStreams( api, { owner: 'me', repo: 'renders' } );
	const s = lib.streams.find( x => x.slug === 'my-clip' );
	assert.deepEqual( s.versions.map( v => v.tag ), [ 'my-clip/v2', 'my-clip/v1' ] );
	assert.equal( s.state, 'current' ); assert.equal( s.serving, 'my-clip/v2' );
	assert.equal( s.nextVersion, 3 );
	assert.deepEqual( s.rungs.length > 0, true ); assert.equal( s.hasManifest, true ); assert.equal( s.hasPoster, true );
	assert.match( s.base, /@my-clip\/v2\/my-clip\/$/ );
	assert.equal( s.embed, s.player + '&present=true' );
	assert.match( s.embed, /\/player\/#https:\/\/cdn\.jsdelivr\.net\/gh\/me\/renders@my-clip\/v2\/my-clip\/&present=true$/ );

} );

test( 'a tag taken meanwhile refuses the publish and writes nothing', { skip }, async () => {

	const { api, gh } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } );
	gh.refs.set( 'tags/my-clip/v1', gh.refs.get( 'heads/main' ) );
	const commits = gh.commits.size;
	await assert.rejects( publishPrepared( api, p, { now } ), e => e instanceof ReleaseError && e.code === 'tag-exists' );
	assert.equal( gh.commits.size, commits );
	assert.ok( ! [ ...gh.files().keys() ].some( k => k.startsWith( 'my-clip/' ) ) );

} );

test( 'publishing rides out GitHub\u2019s secondary rate limit', { skip }, async () => {

	const { api, gh } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } );
	gh.rateLimitNext = 2;
	const r = await publishPrepared( api, p, { now } );
	assert.equal( r.tag, 'my-clip/v1' );

} );

test( 'a failed gate cannot be published', { skip }, async () => {

	const { api, gh } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } );
	const commits = gh.commits.size;
	await assert.rejects( publishPrepared( api, { ...p, gate: { ok: false, failures: [ 'a segment is 20 MB or more' ] } } ), /REFUSED: a segment/ );
	assert.equal( gh.commits.size, commits );

} );

test( 'publishing without a token is refused before any write', { skip }, async () => {

	const { gh } = setup();
	const anon = githubApi( { token: null, fetch: gh.fetch } );
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api: anon, deps: fakeDeps, now } );
	await assert.rejects( publishPrepared( anon, p, { now } ), /token is required/ );
	assert.ok( gh.requests.every( r => r.method === 'GET' ) );

} );

test( 'the publish set zips to a valid archive with every file', { skip }, async () => {

	const { api } = setup();
	const p = await prepareUpload( { file: upload(), slug: 'my-clip', repo: 'me/renders', api, deps: fakeDeps, now } );
	const zip = makeZip( p.set.files );
	assert.deepEqual( makeZip( p.set.files ), zip, 'deterministic' );
	const f = join( fixtureDir, 'set.zip' );
	writeFileSync( f, zip );
	const t = spawnSync( 'unzip', [ '-t', f ] );
	if ( t.error ) return;      // no unzip here
	assert.equal( t.status, 0, t.stdout + t.stderr );
	assert.match( String( t.stdout ), new RegExp( `${ p.set.files.length } files|No errors` ) );

} );
