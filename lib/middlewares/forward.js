var utils = require('../utils');
var log = require('../log');
var Buffer = require('buffer').Buffer;
var fs = require('fs');

/**
 * Forward the request directly
 */
function forward(){
  return function forward(req, res, next){
    var url  = utils.processUrl(req);
    var options = {
      url: url,
      method: req.method,
      headers: req.headers
    }
    var buffers = [];
    var cachedResponse, cacheFile;

    req.__reqData = null;

    function checkIfCached() {
        cacheFile = _getCachedResponseFilePath( req );
        if ( ( cachedResponse = _getCachedResponse( req ) ) ) {
            log.info( 'cache hit: ' + cacheFile );
            res.statusCode = cachedResponse.statusCode;
            delete cachedResponse.headers[ 'Date' ];
            delete cachedResponse.headers[ 'date' ];
            cachedResponse.headers[ 'Date' ]
                = new Date().toGMTString();
            res.writeHead(
                cachedResponse.statusCode
                , cachedResponse.headers
            );
            res.write( cachedResponse.body );
            res.end();
            return true;
        }
        return false;
    }

    log.debug('forward: ' + url);
    
    if(utils.isContainBodyData(req.method)){
      req.on('data', function(chunk){
        buffers.push(chunk);
      });

      req.on('end', function(){
        options.data = Buffer.concat(buffers);
        req.__reqData = options.data;
        if ( checkIfCached() ) {
            return;
        }
        utils.request(options, function(err, data, proxyRes){
          _forwardHandler(err, data, proxyRes, req, res);
        });
      });
    }else{
      if ( checkIfCached() ) {
        return;
      }
      utils.request(options, function(err, data, proxyRes){
        _forwardHandler(err, data, proxyRes, req, res)
      }); 
    }
  };
};

function _forwardHandler(err, data, proxyRes, req, res){
  if(err){
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(proxyRes.statusCode, proxyRes.headers);
  res.write(data);
  res.end();
  _cacheResponse( data, req, proxyRes );
}

function _getCachedResponseFilePath( req ) {
  var url = utils.processUrl( req );
  var path = '/tmp/nproxy/cache/';
  var reqData = req.__reqData;
  var questionMarkIndex = url.indexOf( '?' );

  if ( questionMarkIndex < 0 ) {
    questionMarkIndex = url.length;
  }

  var queryString = url.substr( questionMarkIndex + 1 );
  var urlPath = url.substr( 0, questionMarkIndex );
  var md5Crypto = require( 'crypto' ).createHash( 'md5' );
  var md5 = '';

  if ( queryString.length > 0 ) {
    md5 += '_query_' + md5Crypto
      .update( queryString )
      .digest( 'hex' )
      .substr( 0, 7 )
      ;
  }

  if ( reqData ) {
    md5 += '_post_' + md5Crypto 
      .update( reqData ) 
      .digest( 'hex' )
      .substr( 0, 7 )
      ;
  }

  return ( path
    + req.method + '_'
    + urlPath
        .replace( /:/g, '_' )
        .replace( /\//g, '-' )
    + md5
  );
}

function _getCachedResponse( req ) {
  var path = _getCachedResponseFilePath( req );
  var stat;
  var response = {};
  var content, index, headers, body, i, kv;

  try {
    stat = fs.statSync( path );
  }
  catch( e ) {
    // log.error( e );
    stat = null;
  }
  if ( stat && stat.isFile() ) {
    content = fs.readFileSync( path );
    index = content.indexOf( '\r\n\r\n' );
    headers = content.slice( 0, index )
      .toString()
      .split( '\r\n' )
      ;
    body = content.slice( index + 4 );

    response.headers = {};
    for ( var i = 0; i < headers.length; i++ ) {
      kv = headers[ i ].split( /:\s+/ );
      if ( 0 == i ) {
        response[ 'statusCode' ] = kv[ 1 ];
      }
      else {
        response.headers[ kv[ 0 ] ] = kv[ 1 ];
      }
    }

    response.body = body;
    return response;
  }
  return null;
}

function _cacheResponse( data, req, proxyRes ) {
  var statusCode = proxyRes.statusCode;

  if ( 200 != statusCode - 0 ) {
    return;
  }

  var headers = proxyRes.headers;
  var path = _getCachedResponseFilePath( req );
  var writeStream = fs.createWriteStream(
        path
        , { flags: 'w' }
      );

  writeStream.write( 'STATUS: ' + statusCode );
  for ( var i in headers ) {
    writeStream.write( '\r\n' + i + ': ' + headers[ i ] );
  }
  writeStream.write( '\r\n\r\n' );
  writeStream.write( data );
}


module.exports = forward;
