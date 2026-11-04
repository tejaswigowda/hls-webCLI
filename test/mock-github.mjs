// An in-memory GitHub: just the endpoints Strata's release code and browse.js call, with the behaviour they depend on (a tag that exists is 422, a
// non-fast-forward ref move is 422, an empty repository answers 409 to ref queries, a tree can carry deletions). Used as a `fetch`, so no socket is opened.
import { createHash } from 'node:crypto';

const sha1 = x => createHash( 'sha1' ).update( x ).digest( 'hex' );
const json = ( status, body ) => new Response( JSON.stringify( body ), { status, headers: { 'content-type': 'application/json' } } );

export class MockGitHub {

	constructor( { owner = 'me', repo = 'renders', branch = 'main', token = 'tok', empty = false } = {} ) {

		this.full = `${ owner }/${ repo }`; this.branch = branch; this.token = token;
		this.blobs = new Map(); this.trees = new Map(); this.commits = new Map(); this.refs = new Map();
		this.requests = [];
		this.rateLimitNext = 0;
		if ( ! empty ) this.commitFiles( { 'README.md': 'init\n' }, 'init' );

	}

	blob( bytes ) {

		const b = typeof bytes === 'string' ? new TextEncoder().encode( bytes ) : bytes;
		const sha = sha1( 'blob ' + b.length + Buffer.from( b ).toString( 'latin1' ) );
		this.blobs.set( sha, b );
		return sha;

	}

	/** Seeds a commit on the branch with `files` (path -> string|bytes, null deletes) on top of what is there. Returns the commit sha. */
	commitFiles( files, message, { tag = null } = {} ) {

		const parent = this.refs.get( 'heads/' + this.branch );
		const tree = new Map( parent ? this.flat( this.commits.get( parent ).tree ) : [] );
		for ( const [ p, c ] of Object.entries( files ) ) { if ( c === null ) tree.delete( p ); else tree.set( p, this.blob( c ) ); }
		const treeSha = this.putTree( tree );
		const commit = sha1( 'commit' + treeSha + message + this.commits.size );
		this.commits.set( commit, { tree: treeSha, parents: parent ? [ parent ] : [], message } );
		this.refs.set( 'heads/' + this.branch, commit );
		if ( tag ) this.refs.set( 'tags/' + tag, commit );
		return commit;

	}

	putTree( flat ) { const sha = sha1( 'tree' + [ ...flat ].sort().join() ); this.trees.set( sha, new Map( flat ) ); return sha; }
	flat( treeSha ) { return this.trees.get( treeSha ); }

	treeAt( ref ) {

		if ( this.refs.has( 'heads/' + ref ) ) return this.flat( this.commits.get( this.refs.get( 'heads/' + ref ) ).tree );
		if ( this.refs.has( 'tags/' + ref ) ) return this.flat( this.commits.get( this.refs.get( 'tags/' + ref ) ).tree );
		const [ sha, sub ] = ref.split( ':' );
		const t = this.trees.get( sha ) || ( this.commits.has( sha ) && this.flat( this.commits.get( sha ).tree ) );
		if ( ! t ) return null;
		if ( sub === undefined ) return t;
		const prefix = decodeURIComponent( sub ) + '/';
		const out = new Map( [ ...t ].filter( ( [ p ] ) => p.startsWith( prefix ) ).map( ( [ p, s ] ) => [ p.slice( prefix.length ), s ] ) );
		return out.size ? out : null;

	}

	fetch = async ( url, init = {} ) => {

		const u = new URL( url ), method = ( init.method || 'GET' ).toUpperCase(), path = decodeURIComponent( u.pathname ), body = init.body ? JSON.parse( init.body ) : null;
		const auth = init.headers && init.headers.Authorization;
		this.requests.push( { method, path, bytes: init.body ? init.body.length : 0, auth: !! auth } );
		if ( auth && auth !== `Bearer ${ this.token }` ) return json( 401, { message: 'Bad credentials' } );
		if ( method !== 'GET' && ! auth ) return json( 401, { message: 'Requires authentication' } );
		if ( method !== 'GET' && this.rateLimitNext > 0 ) { this.rateLimitNext --; return json( 403, { message: 'You have exceeded a secondary rate limit' } ); }
		const R = '/repos/' + this.full;
		let m;
		if ( path === R && method === 'GET' ) return json( 200, { default_branch: this.branch, full_name: this.full } );
		if ( ( m = new RegExp( '^' + R + '/git/trees/(.+)$' ).exec( path ) ) && method === 'GET' ) {

			const t = this.treeAt( m[ 1 ] );
			if ( ! t ) return json( 404, { message: 'Not Found' } );
			return json( 200, { sha: sha1( m[ 1 ] ), truncated: false, tree: [ ...t ].map( ( [ p, s ] ) => ( { path: p, type: 'blob', sha: s, size: this.blobs.get( s ).length } ) ) } );

		}
		if ( path.startsWith( R + '/git/matching-refs/tags/' ) && method === 'GET' ) {

			if ( ! this.refs.size ) return json( 409, { message: 'Git Repository is empty.' } );
			const prefix = 'tags/' + path.slice( ( R + '/git/matching-refs/tags/' ).length );
			const all = [ ...this.refs ].filter( ( [ r ] ) => r.startsWith( prefix ) ).map( ( [ r, sha ] ) => ( { ref: 'refs/' + r, object: { sha } } ) );
			const per = Number( u.searchParams.get( 'per_page' ) || 30 ), page = Number( u.searchParams.get( 'page' ) || 1 );
			return json( 200, all.slice( ( page - 1 ) * per, page * per ) );

		}
		if ( ( m = new RegExp( '^' + R + '/contents/(.+)$' ).exec( path ) ) && method === 'GET' ) {

			const t = this.treeAt( u.searchParams.get( 'ref' ) || this.branch ), s = t && t.get( m[ 1 ] );
			return s ? new Response( this.blobs.get( s ) ) : json( 404, { message: 'Not Found' } );

		}
		if ( ( m = new RegExp( '^' + R + '/git/ref/heads/(.+)$' ).exec( path ) ) && method === 'GET' ) {

			const sha = this.refs.get( 'heads/' + m[ 1 ] );
			return sha ? json( 200, { object: { sha } } ) : json( 404, { message: 'Not Found' } );

		}
		if ( ( m = new RegExp( '^' + R + '/git/commits/(.+)$' ).exec( path ) ) && method === 'GET' ) {

			const c = this.commits.get( m[ 1 ] );
			return c ? json( 200, { sha: m[ 1 ], tree: { sha: c.tree }, parents: c.parents.map( sha => ( { sha } ) ) } ) : json( 404, { message: 'Not Found' } );

		}
		if ( path === R + '/git/blobs' && method === 'POST' ) return json( 201, { sha: this.blob( Buffer.from( body.content, 'base64' ) ) } );
		if ( path === R + '/git/trees' && method === 'POST' ) {

			const flat = new Map( this.flat( body.base_tree ) );
			for ( const it of body.tree ) { if ( it.sha === null ) flat.delete( it.path ); else flat.set( it.path, it.sha ); }
			return json( 201, { sha: this.putTree( flat ) } );

		}
		if ( path === R + '/git/commits' && method === 'POST' ) {

			const sha = sha1( 'commit' + body.tree + body.message + this.commits.size );
			this.commits.set( sha, { tree: body.tree, parents: body.parents, message: body.message } );
			return json( 201, { sha } );

		}
		if ( ( m = new RegExp( '^' + R + '/git/refs/heads/(.+)$' ).exec( path ) ) && method === 'PATCH' ) {

			const cur = this.refs.get( 'heads/' + m[ 1 ] );
			if ( ! this.commits.get( body.sha ).parents.includes( cur ) ) return json( 422, { message: 'Update is not a fast forward' } );
			this.refs.set( 'heads/' + m[ 1 ], body.sha );
			return json( 200, { object: { sha: body.sha } } );

		}
		if ( path === R + '/git/refs' && method === 'POST' ) {

			const name = body.ref.replace( /^refs\//, '' );
			if ( this.refs.has( name ) ) return json( 422, { message: 'Reference already exists' } );
			this.refs.set( name, body.sha );
			return json( 201, { ref: body.ref, object: { sha: body.sha } } );

		}
		if ( ( m = new RegExp( '^' + R + '/contents/(.+)$' ).exec( path ) ) && method === 'PUT' ) { this.commitFiles( { [ m[ 1 ] ]: Buffer.from( body.content, 'base64' ) }, body.message ); return json( 201, {} ); }
		return json( 404, { message: 'Not Found: ' + method + ' ' + path } );

	};

	files( ref = this.branch ) { const t = this.treeAt( ref ); return t ? new Map( [ ...t ].map( ( [ p, s ] ) => [ p, this.blobs.get( s ) ] ) ) : null; }

}
