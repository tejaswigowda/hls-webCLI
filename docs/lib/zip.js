// ── zip.js ─────────────────────────────────────────────────────────────────────
// A store-only (uncompressed) ZIP of the publish set, so it can be downloaded as one file. Video segments are already compressed, so deflating them would cost time
// for nothing. Deterministic: the same files give the same bytes (fixed timestamp, sorted order).

const TABLE = ( () => { const t = new Uint32Array( 256 ); for ( let n = 0; n < 256; n ++ ) { let c = n; for ( let k = 0; k < 8; k ++ ) c = c & 1 ? 0xEDB88320 ^ ( c >>> 1 ) : c >>> 1; t[ n ] = c >>> 0; } return t; } )();

export function crc32( bytes ) {

	let c = 0xFFFFFFFF;
	for ( let i = 0; i < bytes.length; i ++ ) c = TABLE[ ( c ^ bytes[ i ] ) & 0xFF ] ^ ( c >>> 8 );
	return ( c ^ 0xFFFFFFFF ) >>> 0;

}

const DOS_TIME = 0, DOS_DATE = ( ( 2020 - 1980 ) << 9 ) | ( 1 << 5 ) | 1;     // 2020-01-01 00:00

/** @param {{ path: string, bytes: Uint8Array }[]} files @returns {Uint8Array} */
export function makeZip( files ) {

	const enc = new TextEncoder();
	const sorted = [ ...files ].sort( ( a, b ) => a.path < b.path ? - 1 : a.path > b.path ? 1 : 0 );
	const total = sorted.reduce( ( n, f ) => n + f.bytes.length + 2 * enc.encode( f.path ).length + 30 + 46, 22 );
	if ( sorted.length >= 0xFFFF || total >= 0xFFFFFFFF ) throw new Error( 'This set is too large for a plain ZIP (4 GB or 65,535 files). Publish it, or save it to a folder.' );
	const out = new Uint8Array( total ), dv = new DataView( out.buffer );
	let p = 0;
	const central = [];
	for ( const f of sorted ) {

		const name = enc.encode( f.path ), crc = crc32( f.bytes );
		central.push( { name, crc, size: f.bytes.length, offset: p } );
		dv.setUint32( p, 0x04034b50, true ); dv.setUint16( p + 4, 20, true ); dv.setUint16( p + 6, 0x0800, true ); dv.setUint16( p + 8, 0, true );
		dv.setUint16( p + 10, DOS_TIME, true ); dv.setUint16( p + 12, DOS_DATE, true ); dv.setUint32( p + 14, crc, true );
		dv.setUint32( p + 18, f.bytes.length, true ); dv.setUint32( p + 22, f.bytes.length, true ); dv.setUint16( p + 26, name.length, true ); dv.setUint16( p + 28, 0, true );
		out.set( name, p + 30 ); out.set( f.bytes, p + 30 + name.length );
		p += 30 + name.length + f.bytes.length;

	}
	const start = p;
	for ( const c of central ) {

		dv.setUint32( p, 0x02014b50, true ); dv.setUint16( p + 4, 20, true ); dv.setUint16( p + 6, 20, true ); dv.setUint16( p + 8, 0x0800, true ); dv.setUint16( p + 10, 0, true );
		dv.setUint16( p + 12, DOS_TIME, true ); dv.setUint16( p + 14, DOS_DATE, true ); dv.setUint32( p + 16, c.crc, true );
		dv.setUint32( p + 20, c.size, true ); dv.setUint32( p + 24, c.size, true ); dv.setUint16( p + 28, c.name.length, true );
		dv.setUint32( p + 42, c.offset, true );
		out.set( c.name, p + 46 );
		p += 46 + c.name.length;

	}
	dv.setUint32( p, 0x06054b50, true ); dv.setUint16( p + 8, central.length, true ); dv.setUint16( p + 10, central.length, true );
	dv.setUint32( p + 12, p - start, true ); dv.setUint32( p + 16, start, true );
	return out.subarray( 0, p + 22 );

}
