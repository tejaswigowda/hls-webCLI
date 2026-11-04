import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoUrl, githubApi, trackedFetchBytes, GitHubError } from '../docs/lib/github.js';
import { createLedger } from '../docs/lib/ledger.js';
import { streamsOfTree, describeFiles } from '../docs/lib/browse.js';
import { MockGitHub } from './mock-github.mjs';

test( 'a repository is named by URL, shorthand or tree address', () => {

	assert.deepEqual( parseRepoUrl( 'https://github.com/me/renders' ), { owner: 'me', repo: 'renders', ref: null, path: null } );
	assert.deepEqual( parseRepoUrl( 'github.com/me/renders.git' ), { owner: 'me', repo: 'renders', ref: null, path: null } );
	assert.deepEqual( parseRepoUrl( 'https://github.com/me/renders/tree/main/cafe' ), { owner: 'me', repo: 'renders', ref: 'main', path: 'cafe' } );
	assert.deepEqual( parseRepoUrl( 'me/renders@cafe/v1' ), { owner: 'me', repo: 'renders', ref: 'cafe/v1', path: null } );
	assert.equal( parseRepoUrl( 'not a repo' ), null );
	assert.equal( parseRepoUrl( 'https://evil.example/me/renders' ), null );

} );

test( 'the ledger counts bodies sent apart from reads, and persists', () => {

	const store = new Map();
	const storage = { getItem: k => store.get( k ) ?? null, setItem: ( k, v ) => store.set( k, v ) };
	const l = createLedger( storage );
	l.record( { kind: 'read', bytesIn: 100 } );
	assert.deepEqual( l.totals(), { writes: 0, bytesSent: 0, reads: 1, bytesRead: 100 } );
	l.record( { kind: 'write', bytesOut: 50 } );
	assert.deepEqual( createLedger( storage ).totals(), { writes: 1, bytesSent: 50, reads: 1, bytesRead: 100 }, 'a later visit sees the same ledger' );

} );

test( 'reads without a token carry no Authorization header; a write without one never leaves', async () => {

	const gh = new MockGitHub();
	const ledger = createLedger();
	const api = githubApi( { fetch: gh.fetch, ledger } );
	await api.get( '/repos/me/renders' );
	assert.equal( gh.requests[ 0 ].auth, false );
	await assert.rejects( async () => api.send( 'POST', '/repos/me/renders/git/blobs', { content: 'x' } ), e => e instanceof GitHubError && e.status === 401 );
	assert.equal( gh.requests.length, 1 );
	assert.equal( ledger.totals().bytesSent, 0 );

} );

test( 'a bad token is a 401 error with GitHub\u2019s message', async () => {

	const gh = new MockGitHub();
	const api = githubApi( { token: 'wrong', fetch: gh.fetch } );
	await assert.rejects( api.get( '/repos/me/renders' ), /GitHub 401: .*Bad credentials/ );

} );

test( 'a verifier read is counted as a read of that host', async () => {

	const ledger = createLedger();
	const get = trackedFetchBytes( { ledger, fetch: async () => new Response( new Uint8Array( 10 ) ) } );
	assert.equal( ( await get( 'https://cdn.jsdelivr.net/gh/a/b@t/x' ) ).length, 10 );
	assert.deepEqual( ledger.totals(), { writes: 0, bytesSent: 0, reads: 1, bytesRead: 10 } );
	const miss = trackedFetchBytes( { ledger, fetch: async () => new Response( 'no', { status: 404 } ) } );
	await assert.rejects( miss( 'https://cdn.jsdelivr.net/gh/a/b@t/y' ), e => e.status === 404 );

} );

test( 'streams are the folders that hold a master.m3u8, each file counted for the deepest one', () => {

	const blob = ( path, size = 1 ) => ( { type: 'blob', path, size } );
	const tree = [ blob( 'README.md' ), blob( 'a/master.m3u8' ), blob( 'a/render.json', 10 ), blob( 'a/1080p60/index.m3u8' ), blob( 'a/audio/index.m3u8' ), blob( 'a/captions.vtt' ), blob( 'a/poster.jpg' ), blob( 'a/files.sha256' ),
		blob( 'b/c/master.m3u8' ), blob( 'b/c/x.bin', 5 ), { type: 'tree', path: 'b' } ];
	const s = streamsOfTree( tree );
	assert.deepEqual( s.map( x => x.slug ), [ 'a', 'b/c' ] );
	const d = describeFiles( s[ 0 ].files );
	assert.deepEqual( { rungs: d.rungs, audio: d.hasAudio, cap: d.hasCaptions, poster: d.hasPoster, manifest: d.hasManifest, rj: d.hasRenderJson, files: d.files }, { rungs: [ '1080p60' ], audio: true, cap: true, poster: true, manifest: true, rj: true, files: 7 } );
	assert.equal( s[ 1 ].files.length, 2 );

} );
