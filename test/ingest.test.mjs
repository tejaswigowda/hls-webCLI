import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVideo, wouldRefuse } from '../docs/lib/ingest.js';
import { HAS_FFMPEG, fixture, rotated } from './fixtures.mjs';

const skip = HAS_FFMPEG ? false : 'no ffmpeg on this machine to make fixtures';

test( 'a constant-rate file becomes a master', { skip }, () => {

	const r = inspectVideo( fixture( 'cfr30' ) );
	assert.equal( r.ok, true, JSON.stringify( r.refusals ) );
	const m = r.master;
	assert.equal( m.width, 320 ); assert.equal( m.height, 180 ); assert.equal( m.fps, 30 );
	assert.equal( m.samples.length, 240 );
	assert.deepEqual( m.keyframes.slice( 0, 3 ), [ 0, 60, 120 ] );
	assert.equal( m.avcC[ 0 ], 1, 'avcC configurationVersion' );
	assert.equal( m.ptsUs, undefined, 'no reordering, so no timestamps to override' );
	assert.equal( r.hasAudio, true );
	assert.ok( m.samples.every( s => s.length > 4 ) );

} );

test( 'B-frames: decode order is kept and every sample gets its presentation slot', { skip }, () => {

	const r = inspectVideo( fixture( 'bframes' ) );
	assert.equal( r.ok, true, JSON.stringify( r.refusals ) );
	assert.equal( r.info.reordered, true );
	const t = r.master.ptsUs;
	assert.equal( t.length, 100 );
	assert.notDeepEqual( t, [ ...t ].sort( ( a, b ) => a - b ), 'decode order is not presentation order' );
	assert.deepEqual( [ ...t ].sort( ( a, b ) => a - b ), Array.from( { length: 100 }, ( _, n ) => Math.round( n * 1e6 / 25 ) ), 'each slot used once, on the n / fps grid' );
	assert.equal( t[ 0 ], 0, 'the first frame decoded is the first shown' );

} );

test( 'a variable-rate file is refused: vfr-input', { skip }, () => {

	const w = wouldRefuse( fixture( 'vfr' ) );
	assert.equal( w.reason, 'vfr-input' );
	assert.match( w.detail, /evenly spaced/ );

} );

test( '29.97 fps is refused rather than rounded to 30', { skip }, () => {

	const w = wouldRefuse( fixture( 'frac2997' ) );
	assert.equal( w.reason, 'fractional-frame-rate' );
	assert.match( w.detail, /29\.97/ );

} );

test( 'a fragmented MP4, HEVC, a rotated track and garbage are each refused with their own reason', { skip }, () => {

	assert.equal( wouldRefuse( fixture( 'fragmented' ) ).reason, 'fragmented-input' );
	assert.equal( wouldRefuse( fixture( 'hevc' ) ).reason, 'unsupported-codec' );
	assert.equal( wouldRefuse( rotated() ).reason, 'rotated-input' );
	assert.equal( wouldRefuse( new Uint8Array( 100 ).fill( 7 ) ).reason, 'not-mp4' );

} );

test( 'a file with one keyframe is accepted (frame 0 is a keyframe); a truncated one is refused', { skip }, () => {

	const one = fixture( 'onekey' );
	assert.equal( wouldRefuse( one ), null );
	const cut = fixture( 'cfr30' ).slice( 0, 20000 );
	assert.ok( wouldRefuse( cut ), 'a cut file is refused' );

} );

test( 'a single frame has no frame rate: unknown-frame-rate', { skip }, () => {

	assert.equal( wouldRefuse( fixture( 'oneframe' ) ).reason, 'unknown-frame-rate' );

} );
