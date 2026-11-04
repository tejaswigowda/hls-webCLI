// This tool reads what Strata wrote and writes what Strata reads: one render.json, version 2, no dialect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { validateRenderJson } from '../docs/strata/renderJson.js';
import { validatePublication, publicationOf } from '../docs/strata/releases.js';
import { summariseRender } from '../docs/lib/browse.js';

const schema = JSON.parse( readFileSync( new URL( '../docs/strata/render.schema.json', import.meta.url ) ) );
const validate = new Ajv( { strict: false, allErrors: true } ).compile( schema );
const dir = new URL( './strata-renders/', import.meta.url );

for ( const name of readdirSync( dir ) ) {

	test( `Strata's published ${ name }/render.json is read without complaint`, () => {

		const j = JSON.parse( readFileSync( new URL( `${ name }/render.json`, dir ) ) );
		assert.equal( j.version, 2 );
		assert.equal( validate( j ), true, JSON.stringify( validate.errors ) );
		assert.deepEqual( validateRenderJson( j ), [] );
		assert.deepEqual( validatePublication( j.publication ), [] );
		const s = summariseRender( j );
		assert.equal( s.tag, publicationOf( j ).tag );
		assert.ok( s.fps > 0 && s.renditions.length >= 1 );

	} );

}
