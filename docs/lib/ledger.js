// ── ledger.js ──────────────────────────────────────────────────────────────────
// What this page has put on the network. Nothing leaves the browser unless the user presses Publish; the proof is a counter: every request the page makes goes
// through record(), and a request with a body is a "write". Reads (listing a repository, verifying a mirror) send only a URL and are counted separately.
// Persistent across visits when given a storage (localStorage); in memory otherwise (tests).

const KEY = 'hls-webcli:ledger:v1', CAP = 500;

export function createLedger( storage = null ) {

	let entries = [];
	try { entries = storage ? JSON.parse( storage.getItem( KEY ) || '[]' ) : []; } catch ( e ) { entries = []; }
	const listeners = new Set();
	const save = () => { try { if ( storage ) storage.setItem( KEY, JSON.stringify( entries.slice( - CAP ) ) ); } catch ( e ) { /* full or blocked: the in-memory ledger still counts */ } };

	return {
		record( e ) {

			entries.push( { at: new Date().toISOString(), kind: 'read', bytesOut: 0, bytesIn: 0, ...e } );
			if ( entries.length > CAP ) entries = entries.slice( - CAP );
			save();
			listeners.forEach( f => f( this.totals() ) );

		},
		entries: () => entries.slice(),
		/** { writes, bytesSent, reads, bytesRead }: `bytesSent` is what was uploaded (request bodies), and is the number that should read 0. */
		totals() {

			const w = entries.filter( e => e.kind === 'write' ), r = entries.filter( e => e.kind === 'read' );
			return { writes: w.length, bytesSent: w.reduce( ( n, e ) => n + e.bytesOut, 0 ), reads: r.length, bytesRead: r.reduce( ( n, e ) => n + e.bytesIn, 0 ) };

		},
		onChange( f ) { listeners.add( f ); return () => listeners.delete( f ); },
		clear() { entries = []; save(); listeners.forEach( f => f( this.totals() ) ); },
	};

}
