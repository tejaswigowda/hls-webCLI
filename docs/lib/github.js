// ── github.js ──────────────────────────────────────────────────────────────────
// The GitHub REST calls the release code (strata/releases.js) asks for: api.get( path ) and api.send( method, path, body ). Reads work without a token on public
// repositories; writes need one. Every request is written to the ledger, so what this page has sent is a number that can be read, not a promise.
// The rate-limit retry and the Authorization handling follow Strata's Menubar.Git.js.

/** { owner, repo, ref, path } from "github.com/o/r", "https://github.com/o/r/tree/main/some/dir", "o/r", "o/r@tag" or "o/r.git"; null when it is none of those. */
export function parseRepoUrl( input ) {

	const s = String( input || '' ).trim().replace( /\.git$/, '' ).replace( /\/+$/, '' );
	let m = /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/(.+))?)?$/.exec( s );
	if ( m ) return { owner: m[ 1 ], repo: m[ 2 ], ref: m[ 3 ] ? decodeURIComponent( m[ 3 ] ) : null, path: m[ 4 ] || null };
	m = /^([\w.-]+)\/([\w.-]+)(?:@(\S+))?$/.exec( s );
	if ( m ) return { owner: m[ 1 ], repo: m[ 2 ], ref: m[ 3 ] || null, path: null };
	return null;

}

export class GitHubError extends Error {

	constructor( status, body, path ) {

		super( `GitHub ${ status }: ${ body }` );
		this.name = 'GitHubError';
		this.status = status;
		this.path = path;

	}

}

const sleep = ms => new Promise( r => setTimeout( r, ms ) );

/** GitHub throttles content creation (secondary rate limit, 403/429): wait it out and retry the same request rather than fail a whole publish. */
export async function withRateLimitRetry( request, onWait, wait = sleep ) {

	for ( let attempt = 0; ; attempt ++ ) {

		try { return await request(); } catch ( err ) {

			const limited = ( err.status === 403 || err.status === 429 ) && /rate limit/i.test( err.message );
			if ( ! limited || attempt >= 4 ) throw err;
			const seconds = 70 * ( attempt + 1 );
			if ( onWait ) onWait( seconds );
			await wait( seconds * 1000 );

		}

	}

}

/**
 * @param {{ token?: string|null, fetch?: typeof fetch, ledger?: {record: Function}, onWait?: Function, base?: string, wait?: Function }} o
 */
export function githubApi( { token = null, fetch: doFetch = globalThis.fetch, ledger = null, onWait = null, base = 'https://api.github.com', wait = sleep } = {} ) {

	const host = new URL( base ).host;
	const headers = accept => ( { Accept: accept, ...( token ? { Authorization: `Bearer ${ token }` } : {} ) } );

	async function call( method, path, { body = null, accept = 'application/vnd.github+json', purpose } ) {

		const payload = body === null ? undefined : JSON.stringify( body );
		const res = await doFetch( base + path, { method, headers: { ...headers( accept ), ...( payload ? { 'Content-Type': 'application/json' } : {} ) }, body: payload, cache: 'no-store' } );
		const buf = res.ok || ! res.text ? new Uint8Array( await res.arrayBuffer() ) : new TextEncoder().encode( await res.text() );
		if ( ledger ) ledger.record( { kind: method === 'GET' ? 'read' : 'write', method, host, path: path.split( '?' )[ 0 ], bytesOut: payload ? new TextEncoder().encode( payload ).length : 0, bytesIn: buf.length, status: res.status, purpose } );
		if ( ! res.ok ) throw new GitHubError( res.status, new TextDecoder().decode( buf ), path );
		return buf;

	}

	return {
		token: !! token,
		get: async ( path, { purpose = 'browse' } = {} ) => JSON.parse( new TextDecoder().decode( await call( 'GET', path, { purpose } ) ) ),
		/** A file's bytes through the contents API's raw media type (no 1 MB cap). */
		getBytes: ( path, { purpose = 'browse' } = {} ) => call( 'GET', path, { accept: 'application/vnd.github.raw', purpose } ),
		send: ( method, path, body, { purpose = 'publish' } = {} ) => {

			if ( ! token ) throw new GitHubError( 401, 'A token is required to publish.', path );
			return withRateLimitRetry( async () => JSON.parse( new TextDecoder().decode( await call( method, path, { body, purpose } ) ) ), onWait, wait );

		},
	};

}

/** A fetchBytes( url ) for the verifier (strata/filesManifest.js verifyBase): GETs a file from wherever it is served, and writes the read to the ledger. */
export function trackedFetchBytes( { ledger = null, fetch: doFetch = globalThis.fetch, timeoutMs = 60000, purpose = 'verify' } = {} ) {

	return async url => {

		const u = new URL( url );
		const res = await doFetch( url, { cache: 'no-store', signal: AbortSignal.timeout( timeoutMs ) } );
		const bytes = res.ok ? new Uint8Array( await res.arrayBuffer() ) : new Uint8Array( 0 );
		if ( ledger ) ledger.record( { kind: 'read', method: 'GET', host: u.host, path: u.pathname, bytesOut: 0, bytesIn: bytes.length, status: res.status, purpose } );
		if ( ! res.ok ) throw Object.assign( new Error( `HTTP ${ res.status }` ), { status: res.status } );
		return bytes;

	};

}
