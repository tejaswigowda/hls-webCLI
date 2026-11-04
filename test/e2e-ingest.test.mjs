// The decode path on files that differ from Strata's own masters: B-frames (decode order is not display order), a 720p source (a ladder of two rungs, with
// 6 s and 1 s segments), and a refusal shown in the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, fixtureDir } from './fixtures.mjs';
import { skip, startApp } from './e2e-helpers.mjs';

async function prepare( page, file, name ) {

	await page.click( '#tab-upload' );
	const dir = join( fixtureDir, 'e2e2' ); mkdirSync( dir, { recursive: true } );
	const path = join( dir, name ); writeFileSync( path, file );
	await page.setInputFiles( '#video', path );
	await page.waitForSelector( '#analysis .refusal, #upload-form:not([hidden])' );
	return path;

}

test( 'a 720p source with B-frames becomes a two-rung ladder whose frames are all there, in order', { skip, timeout: 240000 }, async t => {

	const { page } = await startApp( t );
	await prepare( page, fixture( 'hdb' ), 'Bee Frames.mp4' );
	assert.match( await page.textContent( '#analysis' ), /1280×720 at 30 fps, 210 frames.*B-frames, no audio/ );
	await page.fill( '#dest-repo', 'me/renders' );
	await page.click( '#prepare' );
	await page.waitForSelector( '#review:not([hidden])', { timeout: 180000 } ).catch( async e => { throw new Error( e.message + ' | ' + await page.textContent( '#upload-status' ) ); } );
	const r = await page.evaluate( () => ( { ok: window.__webcli_result.ok, gate: window.__webcli_result.gate, j: window.__webcli_result.renderJson, bytes: Array.from( window.__webcli_result.bytes ) } ) );
	assert.equal( r.gate.ok, true, r.gate.failures.join( '; ' ) );
	assert.deepEqual( r.j.outputs.renditions.map( x => x.name ), [ '720p30', '480p30' ] );
	assert.equal( r.j.outputs.audio, null );
	assert.equal( r.j.render.frames, 210 );

	const dir = join( fixtureDir, 'e2e2' ), zip = join( dir, 'set.zip' );
	writeFileSync( zip, Buffer.from( r.bytes ) );
	execFileSync( 'unzip', [ '-o', '-q', zip, '-d', join( dir, 'out' ) ] );
	for ( const rung of r.j.outputs.renditions ) {

		const base = join( dir, 'out', 'bee-frames', rung.name );
		const parts = [ 'init.mp4', ...Array.from( { length: rung.segments }, ( _, i ) => `seg${ String( i + 1 ).padStart( 5, '0' ) }.m4s` ) ].map( f => `"${ base }/${ f }"` ).join( ' ' );
		const joined = join( dir, rung.name + '.mp4' );
		execFileSync( 'sh', [ '-c', `cat ${ parts } > "${ joined }"` ] );
		const frames = execFileSync( 'ffprobe', [ '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', joined ] ).toString().trim();
		assert.equal( frames, `${ rung.width },${ rung.height },210`, rung.name + ' holds every frame' );
		// presentation times are exactly n / 30 s: the frame count and the duration agree
		const pts = execFileSync( 'ffprobe', [ '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'default=nw=1:nk=1', joined ] ).toString().trim().split( '\n' ).map( Number ).sort( ( a, b ) => a - b );
		assert.ok( pts.every( ( p, n ) => Math.abs( p - n / 30 ) < 1e-3 ), rung.name + ': timestamps are n / 30' );
		// segments are 6 s and then the remainder, each on a keyframe
		for ( let n = 1; n <= rung.segments; n ++ ) {

			const seg = join( dir, `s${ rung.name }${ n }.mp4` );
			execFileSync( 'sh', [ '-c', `cat "${ base }/init.mp4" "${ base }/seg${ String( n ).padStart( 5, '0' ) }.m4s" > "${ seg }"` ] );
			const first = execFileSync( 'ffprobe', [ '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame,pict_type', '-of', 'csv=p=0', '-read_intervals', '%+#1', seg ] ).toString().trim();
			assert.match( first, /^1,I/ );

		}

	}
	const playlist = Buffer.from( r.bytes ).length > 0 && execFileSync( 'cat', [ join( dir, 'out', 'bee-frames', '720p30', 'index.m3u8' ) ] ).toString();
	assert.deepEqual( [ ...playlist.matchAll( /#EXTINF:([\d.]+)/g ) ].map( m => Number( m[ 1 ] ) ), [ 6, 1 ] );

} );

test( 'a variable-rate file is refused in the page, with its reason code, and nothing is offered', { skip, timeout: 60000 }, async t => {

	const { page } = await startApp( t );
	await prepare( page, fixture( 'vfr' ), 'vfr.mp4' );
	assert.match( await page.textContent( '#analysis' ), /vfr-input/ );
	assert.equal( await page.isVisible( '#upload-form' ), false );
	const r = await page.evaluate( () => window.__webcli_result );
	assert.equal( r.ok, false ); assert.equal( r.code, 'vfr-input' );

} );
