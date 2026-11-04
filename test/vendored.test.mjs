import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dir = new URL( '../docs/strata/', import.meta.url );
const manifest = JSON.parse( readFileSync( new URL( 'vendored.json', dir ) ) );

for ( const f of manifest.files ) {

	test( `${ f.file } is Strata's file at ${ manifest.commit.slice( 0, 7 ) }, with only its declared patches`, () => {

		const bytes = readFileSync( new URL( f.file, dir ) ), text = bytes.toString();
		const markers = ( text.match( /hls-webcli patch/g ) || [] ).length;
		assert.equal( markers, f.patches, 'number of marked patches' );
		if ( f.patches === 0 ) assert.equal( createHash( 'sha256' ).update( bytes ).digest( 'hex' ), f.sha256, 'unpatched files are byte-identical to upstream' );

	} );

}
