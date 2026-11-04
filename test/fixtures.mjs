// Test fixtures, made with the ffmpeg on this machine (a test-time tool only: nothing here ships). Tests that need one are skipped when there is no ffmpeg.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HAS_FFMPEG = spawnSync( 'ffmpeg', [ '-version' ] ).status === 0;

const dir = HAS_FFMPEG ? mkdtempSync( join( tmpdir(), 'hls-webcli-' ) ) : null;
export const fixtureDir = dir;

const SPECS = {
	// 8 s, 30 fps, keyframe every 60 frames, AAC audio
	cfr30: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-bf', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest' ],
	// B-frames: decode order differs from presentation order
	bframes: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-c:v', 'libx264', '-preset', 'medium', '-g', '50', '-bf', '3', '-pix_fmt', 'yuv420p' ],
	// variable frame rate: every 7th frame kept
	vfr: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=6', '-vf', "select='not(mod(n,7))+eq(n,1)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p' ],
	frac2997: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30000/1001:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p' ],
	fragmented: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov' ],
	hevc: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libx265', '-tag:v', 'hvc1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p' ],
	// 720p with B-frames and a keyframe every 2 s: three rungs, B-frame timestamps
	hdb: [ '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=7', '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p' ],
	oneframe: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p' ],
	// no audio, one keyframe only
	onekey: [ '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '1000', '-pix_fmt', 'yuv420p' ],
};

const made = new Map();

export function fixture( name ) {

	if ( made.has( name ) ) return made.get( name );
	const out = join( dir, name + '.mp4' );
	execFileSync( 'ffmpeg', [ '-v', 'error', '-y', ...SPECS[ name ], out ], { stdio: 'pipe' } );
	const bytes = new Uint8Array( readFileSync( out ) );
	made.set( name, bytes );
	return bytes;

}

export function rotated() {

	const out = join( dir, 'rotated.mp4' ), src = join( dir, 'rotsrc.mp4' );
	if ( ! existsSync( out ) ) {

		execFileSync( 'ffmpeg', [ '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src ] );
		execFileSync( 'ffmpeg', [ '-v', 'error', '-y', '-display_rotation', '90', '-i', src, '-c', 'copy', out ] );

	}
	return new Uint8Array( readFileSync( out ) );

}
