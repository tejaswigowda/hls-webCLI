#!/usr/bin/env node
// Static file server for docs/.  Usage: node server.js [port]   (default 5510)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join( path.dirname( fileURLToPath( import.meta.url ) ), 'docs' );
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

export function serve( port = 5510 ) {

	const server = http.createServer( ( req, res ) => {

		let p = decodeURIComponent( req.url.split( '?' )[ 0 ] );
		if ( p.endsWith( '/' ) ) p += 'index.html';
		const file = path.join( ROOT, path.normalize( p ) );
		if ( ! file.startsWith( ROOT ) || ! fs.existsSync( file ) || fs.statSync( file ).isDirectory() ) { res.writeHead( 404 ); res.end( 'not found' ); return; }
		res.writeHead( 200, { 'Content-Type': MIME[ path.extname( file ) ] || 'application/octet-stream', 'Cache-Control': 'no-store' } );
		fs.createReadStream( file ).pipe( res );

	} );
	return new Promise( r => server.listen( port, () => r( server ) ) );

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const port = Number( process.argv[ 2 ] || 5510 );
	await serve( port );
	console.log( `hls webCLI on http://localhost:${ port }/` );

}
