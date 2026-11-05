// Shared by the browser tests: the app served locally, a real Chrome, and GitHub / jsDelivr answered in memory (page.route), so nothing leaves this machine.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from '../server.js';
import { MockGitHub } from './mock-github.mjs';
import { HAS_FFMPEG } from './fixtures.mjs';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const skip = ! HAS_FFMPEG ? 'no ffmpeg for fixtures' : ! existsSync( CHROME ) ? 'no Google Chrome at the usual path' : false;

export async function startApp( t ) {

	const server = await serve( 0 );
	t.after( () => server.close() );
	const base = `http://localhost:${ server.address().port }/`;
	const gh = new MockGitHub( { owner: 'me', repo: 'renders' } );
	const browser = await chromium.launch( { executablePath: CHROME, headless: true } );
	t.after( () => browser.close() );
	const page = await ( await browser.newContext( { permissions: [ 'clipboard-read', 'clipboard-write' ] } ) ).newPage();
	const outside = [];
	page.on( 'console', m => { if ( m.type() === 'error' ) console.log( 'console.error:', m.text() ); } );
	page.on( 'pageerror', e => console.log( 'pageerror:', e.message ) );

	await page.route( /^https:\/\//, async route => {

		const req = route.request(), u = new URL( req.url() );
		if ( req.method() === 'OPTIONS' ) return route.fulfill( { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } } );
		outside.push( { method: req.method(), host: u.host, path: u.pathname } );
		if ( u.host === 'api.github.com' ) {

			if ( u.pathname === '/user' ) return route.fulfill( { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify( { login: 'me' } ) } );
			const r = await gh.fetch( req.url(), { method: req.method(), headers: req.headers().authorization ? { Authorization: req.headers().authorization } : {}, body: req.postData() || undefined } );
			return route.fulfill( { status: r.status, headers: { 'content-type': r.headers.get( 'content-type' ) || 'application/octet-stream', 'access-control-allow-origin': '*' }, body: Buffer.from( await r.arrayBuffer() ) } );

		}
		const m = /^\/gh\/me\/renders@([^/]+\/v\d+)\/(.*)$/.exec( u.pathname );
		if ( u.host === 'cdn.jsdelivr.net' && m ) {

			const f = ( gh.files( m[ 1 ] ) || new Map() ).get( decodeURIComponent( m[ 2 ] ) );
			return f ? route.fulfill( { status: 200, headers: { 'access-control-allow-origin': '*' }, body: Buffer.from( f ) } ) : route.fulfill( { status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no' } );

		}
		return route.abort();

	} );
	await page.goto( base );
	return { page, gh, base, outside };

}
