// End to end in a real Chrome: a video goes in, WebCodecs encodes the ladder, the set is prepared, published to an in-memory GitHub, and read back by the Library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, fixtureDir } from './fixtures.mjs';
import { skip, startApp } from './e2e-helpers.mjs';

test( 'upload, prepare, publish and list in a real browser', { skip, timeout: 240000 }, async t => {

	const { page, gh, outside } = await startApp( t );
	assert.match( await page.textContent( '#ledger' ), /uploaded 0 B in 0 requests/ );

	// Upload
	await page.click( '#tab-upload' );
	const dir = join( fixtureDir, 'e2e' ); mkdirSync( dir, { recursive: true } );
	const clip = join( dir, 'My Clip.mp4' ); writeFileSync( clip, fixture( 'cfr30' ) );
	await page.setInputFiles( '#video', clip );
	await page.waitForSelector( '#upload-form:not([hidden])' );
	assert.match( await page.textContent( '#analysis' ), /320×180 at 30 fps, 240 frames/ );
	assert.equal( await page.inputValue( '#dest-slug' ), 'my-clip' );
	await page.fill( '#dest-repo', 'me/renders' );
	await page.click( '#prepare' );
	await page.waitForSelector( '#review:not([hidden])', { timeout: 120000 } ).catch( async e => { throw new Error( e.message + ' | status: ' + await page.textContent( '#upload-status' ) ); } );

	const result = await page.evaluate( () => { const r = window.__webcli_result; return { ok: r.ok, filename: r.filename, size: r.size, tag: r.tag, files: r.files, gate: r.gate, renderJson: r.renderJson, hasBytes: r.bytes instanceof Uint8Array, blob: r.blobUrl.slice( 0, 5 ) }; } );
	assert.equal( result.ok, true, JSON.stringify( result.gate ) );
	assert.equal( result.gate.ok, true, result.gate.failures.join( '; ' ) );
	assert.equal( result.filename, 'my-clip-v1.zip' ); assert.equal( result.tag, 'my-clip/v1' ); assert.equal( result.hasBytes, true ); assert.equal( result.blob, 'blob:' );
	const j = result.renderJson;
	assert.equal( j.outputs.audio_present, true, 'the audio track was encoded' );
	assert.ok( Number.isInteger( j.outputs.audio.encoder_delay_samples ) && j.outputs.audio.encoder_delay_samples > 0, 'the encoder delay was measured: ' + j.outputs.audio.encoder_delay_samples );
	assert.equal( j.render.time_source_audit.passed, false );
	console.log( '  rungs:', j.outputs.renditions.map( r => `${ r.name } ${ r.segments } segments, max ${ r.max_segment_bytes } B` ).join( '; ' ), '| encoder delay', j.outputs.audio.encoder_delay_samples );

	// Preparing is local: no request carried a body, and the ledger says so
	assert.ok( outside.every( r => r.method === 'GET' || r.method === 'OPTIONS' ), 'only reads before publishing: ' + JSON.stringify( outside.filter( r => r.method !== 'GET' ) ) );
	assert.match( await page.textContent( '#ledger' ), /uploaded 0 B in 0 requests/ );

	// Every segment of the ladder starts on an IDR frame (decoded and checked with ffprobe, not taken from the encoder's word)
	const zip = Buffer.from( await page.evaluate( () => Array.from( window.__webcli_result.bytes ) ) );
	const zipPath = join( dir, 'set.zip' ); writeFileSync( zipPath, zip );
	execFileSync( 'unzip', [ '-o', '-q', zipPath, '-d', join( dir, 'out' ) ] );
	const rung = j.outputs.renditions[ 0 ], rungDir = join( dir, 'out', 'my-clip', rung.name );
	for ( let n = 1; n <= rung.segments; n ++ ) {

		const seg = String( n ).padStart( 5, '0' ), joined = join( dir, `seg${ seg }.mp4` );
		execFileSync( 'sh', [ '-c', `cat "${ rungDir }/init.mp4" "${ rungDir }/seg${ seg }.m4s" > "${ joined }"` ] );
		const out = execFileSync( 'ffprobe', [ '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame,pict_type', '-of', 'csv=p=0', '-read_intervals', '%+#1', joined ] ).toString().trim();
		assert.match( out, /^1,I/, `segment ${ n } starts on a keyframe (${ out })` );

	}

	// Publish is a separate act: nothing was sent until now
	await page.fill( '#token', 'tok' ); await page.dispatchEvent( '#token', 'change' );
	await page.waitForFunction( () => document.getElementById( 'who' ).textContent.includes( '@me' ) );
	await page.click( '#publish' );
	await page.waitForSelector( '#confirm:not([hidden])' );
	const confirm = await page.textContent( '#confirm-text' );
	assert.match( confirm, /This will send \d+ files, [\d.]+ [KM]B, to github\.com\/me\/renders \(main\) as my-clip\/v1, as @me\./ );
	assert.equal( gh.refs.has( 'tags/my-clip/v1' ), false, 'not sent before the confirmation' );
	const snapshot = () => page.evaluate( () => JSON.stringify( { ...window.__webcli_result, bytes: window.__webcli_result.bytes.length, blobUrl: 0 } ) );
	const before = await snapshot();
	await page.click( '#confirm-yes' );
	await page.waitForSelector( '#receipt:not([hidden])', { timeout: 60000 } );
	assert.ok( gh.refs.has( 'tags/my-clip/v1' ) );
	const receipt = await page.evaluate( () => window.__webcli_receipt );
	assert.equal( receipt.tag, 'my-clip/v1' ); assert.equal( receipt.as, 'me' ); assert.equal( receipt.commit, gh.refs.get( 'tags/my-clip/v1' ) );
	assert.equal( await snapshot(), before, '__webcli_result is the same after publishing' );
	assert.doesNotMatch( await page.textContent( '#ledger' ), /uploaded 0 B/ );

	// Library: the stream is there, as v1, current, and verifies
	await page.click( '#tab-library' );
	await page.fill( '#repo-url', 'github.com/me/renders' );
	await page.click( '#library-form button' );
	await page.waitForSelector( '#library-result table' );
	const row = await page.textContent( '#library-result tbody tr' );
	assert.match( row, /my-clip/ ); assert.match( row, /current/ ); assert.match( row, /v1/ );
	await page.click( '#library-result button:has-text("Verify")' );
	await page.waitForFunction( () => /locations verified/.test( document.querySelector( '.verdicts' ).textContent ), null, { timeout: 60000 } );
	assert.match( await page.textContent( '.verdicts' ), /1 of 1 locations verified/ );

} );
