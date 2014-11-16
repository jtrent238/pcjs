/**
 * @fileoverview Net-related functions
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a> (@jeffpar)
 * @version 1.0
 * Created 2014-03-16
 *
 * Copyright © 2012-2014 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of the JavaScript Machines Project (aka JSMachines) at <http://jsmachines.net/>
 * and <http://pcjs.org/>.
 *
 * JSMachines is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * JSMachines is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with JSMachines.
 * If not, see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see Computer.sCopyright).
 *
 * Some JSMachines files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of the
 * JSMachines Project for purposes of the GNU General Public License, and the author does not claim
 * any copyright as to their contents.
 */

"use strict";

/* global Buffer: false */

var net = {};

if (typeof module !== 'undefined') {
    var sServerRoot;
    var fs = require("fs");
    var http = require("http");
    var path = require("path");
    var url = require("url");
    var str = require("./strlib");
}

/*
 * The following are (super-secret) commands that can be added to the URL to enable special features.
 *
 * Our super-secret command processor is affectionately call Gort, and while Gort doesn't understand commands
 * like "Klaatu barada nikto", it does understand commands like "debug" and "rebuild"; eg:
 *
 *      http://www.pcjs.org/?gort=debug
 *
 * hasParm() detects the presence of the specified command, and propagateParms() is a URL filter that ensures
 * any commands listed in asPropagate are passed through to all other URLs on the same page; using any of these
 * commands also forces the page to be rebuilt and not cached (since we would never want a cached "index.html" to
 * contain/expose any of these commands).
 */
net.GORT_COMMAND    = "gort";
net.GORT_DEBUG      = "debug";          // use this to force uncompiled JavaScript even on a Release server
net.GORT_NODEBUG    = "nodebug";        // use this to force uncompiled JavaScript but with DEBUG code disabled
net.GORT_RELEASE    = "release";        // use this to force the use of compiled JavaScript even on a Debug server
net.GORT_REBUILD    = "rebuild";        // use this to force the "index.html" in the current directory to be rebuilt

net.REVEAL_COMMAND  = "reveal";
net.REVEAL_PDFS     = "pdfs";

/*
 * This is a list of the URL parameters that propagateParms() will propagate from the requester's URL to
 * other URLs provided by the requester.
 */
var asPropagate  = [net.GORT_COMMAND, "autostart"];

/**
 * hasParm(sParm, sValue, req)
 *
 * @param {string} sParm
 * @param {string|null} sValue (pass null to check for the presence of ANY sParm)
 * @param {Object} [req] is the web server's (ie, Express) request object, if any
 * @return {boolean} true if the request Object contains the specified parameter/value, false if not
 *
 * TODO: Consider whether sParm === null should check for the presence of ANY parameter in asPropagate.
 */
net.hasParm = function(sParm, sValue, req)
{
    return (req && req.query && req.query[sParm] && (!sValue || req.query[sParm] == sValue));
};

/**
 * propagateParms(sURL, req)
 *
 * Propagates any "special" query parameters (as listed in asPropagate) from the given
 * request object (req) to the given URL (sURL).
 *
 * We do not modify an sURL that already contains a '?' OR that begins with a protocol
 * (eg, http:, mailto:, etc), in order to keep this function simple, since it's only for
 * debugging purposes anyway.  I also considered blowing off any URLs with a '#' for the
 * same reason, since any hash string must follow any query parameters, but stripping
 * and re-appending the hash string is pretty trivial, so we do handle that.
 *
 * TODO: Make propagateParms() more general-purpose (eg, capable of detecting any URL
 * to the same site, and capable of merging any of our "special" query parameters with any
 * existing query parameters.
 *
 * @param {string|null} sURL
 * @param {Object} [req] is the web server's (ie, Express) request object, if any
 * @return {string} massaged sURL
 */
net.propagateParms = function(sURL, req)
{
    if (sURL !== null && sURL.indexOf('?') < 0) {
        var i;
        var sHash = "";
        if ((i = sURL.indexOf('#')) >= 0) {
            sHash = sURL.substr(i);
            sURL = sURL.substr(0, i);
        }
        var match = sURL.match(/^([a-z])+:(.*)/);
        if (!match && req && req.query) {
            for (i = 0; i < asPropagate.length; i++) {
                var sQuery = asPropagate[i];
                var sValue;
                if ((sValue = req.query[sQuery])) {
                    var sParm = (sURL.indexOf('?') < 0? '?' : '&');
                    sParm += sQuery + '=';
                    if (sURL.indexOf(sParm) < 0) sURL += sParm + encodeURIComponent(sValue);
                }
            }
        }
        sURL += sHash;
    }
    return sURL;
};

/**
 * encodeURL(sURL, req, fDebug)
 *
 * Used to encodes any URLs presented on the current page, using this 3-step process:
 *
 *  1) Replace any backslashes with slashes, in case the URL was derived from a file system path
 *  2) Remap links that begin with "static/" to the corresponding URL at "http://static.pcjs.org/"
 *  3) Massage the result with net.propagateParms(), so that any special parameters are passed along
 *  4) Transform any "htmlspecialchars" into the corresponding entities, to help ensure proper validation
 *
 * @param {string} sURL
 * @param {Object} req is the web server's (ie, Express) request object, if any
 * @param {boolean} [fDebug]
 * @return {string} encoded URL
 */
net.encodeURL = function(sURL, req, fDebug)
{
    if (sURL) {
        sURL = sURL.replace(/\\/g, '/');
        if (!fDebug) {
            if (sURL.match(/^[^:]*static/)) {
                sURL = "http://static.pcjs.org" + path.join(req.path, sURL).replace("/static/", "/");
            }
        }
        return net.propagateParms(encodeURI(sURL), req);
    }
    return sURL;
};

/**
 * isRemote(sPath)
 *
 * @param {string} sPath
 * @return {boolean} true if sPath is a (supported) remote path, false if not
 *
 * TODO: Add support for FTP? HTTPS? Anything else?
 */
net.isRemote = function(sPath)
{
    return (sPath.indexOf("http:") === 0);
};

/**
 * getStat(sURL, done)
 *
 * @param {string} sURL
 * @param {function(Error,Object)} done
 */
net.getStat = function(sURL, done)
{
    var options = url.parse(sURL);
    options.method = "HEAD";
    options.path = options.pathname;    // TODO: Determine the necessity of aliasing this
    var req = http.request(options, function(res) {
        var err = null;
        var stat = null;
        // console.log(JSON.stringify(res.headers));
        if (res.statusCode == 200) {
            /*
             * Apparently Node lower-cases response headers (at least incoming headers, despite
             * lots of amusing whining by certain people in the Node community), which seems like
             * a good thing, because that means I can do two simple key look-ups.
             */
            var sLength = res.headers['content-length'];
            var sModified = res.headers['last-modified'];
            stat = {
                size: sLength? parseInt(sLength, 10) : -1,
                mtime: sModified? new Date(sModified) : null,
                remote: true            // an additional property we provide to indicate this is not your normal stats object
            };
        } else {
            err = new Error("unexpected response code: " + res.statusCode);
        }
        done(err, stat);
    });
    req.on('error', function(err) {
        done(err, null);
    });
    req.end();
};

/**
 * getFile(sURL, sEncoding, done)
 *
 * @param {string} sURL is the source file
 * @param {string|null} sEncoding is the encoding to assume, if any
 * @param {function(Error,number,(string|Buffer))} done receives an Error, an HTTP status code, and a Buffer (if any)
 *
 * TODO: Add support for FTP? HTTPS? Anything else?
 */
net.getFile = function(sURL, sEncoding, done)
{
    /*
     * Buffer objects are a fixed size, so my choices are: 1) call getStat() first, hope it returns
     * the true size, and then preallocate a buffer; or 2) create a new, larger buffer every time a new
     * chunk arrives.  The latter seems best.
     *
     * However, if an encoding is given, we'll simply concatenate all the data into a String and return
     * that instead.  Note that the incoming data is always a Buffer, but concatenation with a String
     * performs an implied "toString()" on the Buffer.
     *
     * WARNING: Even when an encoding is provided, we don't make any attempt to verify that the incoming
     * data matches that encoding.
     */
    var sFile = "";
    var bufFile = null;
    http.get(sURL, function(res) {
        res.on('data', function(data) {
            if (sEncoding) {
                sFile += data;
                return;
            }
            if (!bufFile) {
                bufFile = data;
                return;
            }
            /*
             * We need to grow bufFile.  I used to do this myself, using the "copy" method:
             *
             *      buf.copy(targetBuffer, [targetStart], [sourceStart], [sourceEnd])
             *
             * which defaults to 0 for [targetStart] and [sourceStart], but the docs don't clearly
             * define the default value for [sourceEnd].  They say "buffer.length", but there is no
             * parameter here named "buffer".  Let's hope that in the case of "bufFile.copy(buf)"
             * they meant "bufFile.length".
             *
             * However, it turns out this is moot, because there's a new kid in town: Buffer.concat().
             *
             *      buf = new Buffer(bufFile.length + data.length);
             *      bufFile.copy(buf);
             *      data.copy(buf, bufFile.length);
             *      bufFile = buf;
             */
            bufFile = Buffer.concat([bufFile, data], bufFile.length + data.length);
        }).on('end', function() {
            /*
             * TODO: Decide what to do when res.statusCode is actually an error code (eg, 404), because
             * in such cases, the file content will likely just be an HTML error page.
             */
            if (res.statusCode < 400) {
                done(null, res.statusCode, sEncoding? sFile : bufFile);
            } else {
                done(new Error(sEncoding? sFile : bufFile), res.statusCode, null);
            }
        }).on('error', function(err) {
            done(err, res.statusCode, null);
        });
    });
};

/**
 * downloadFile(sURL, sFile, done)
 *
 * @param {string} sURL is the source file
 * @param {string} sFile is a fully-qualified target file
 * @param {function(Error,number)} done is a callback that receives an Error and a HTTP status code
 */
net.downloadFile = function(sURL, sFile, done)
{
    var file = fs.createWriteStream(sFile);

    /*
     * http.get() accepts a "url" string in lieu of an "options" object; it automatically builds
     * the latter from the former using url.parse(). This is good, because it relieves me from
     * building my own "options" object, and also from wondering why http functions expect "options"
     * to contain a "path" property, whereas url.parse() returns a "pathname" property.
     *
     * Either the documentation isn't quite right for url.parse() or http.request() (the big brother
     * of http.get), or one of those "options" properties is aliased to the other, or...?
     */
    http.get(sURL, function(res) {
        res.on('data', function(data) {
            file.write(data);
        }).on('end', function() {
            file.end();
            /*
             * TODO: We should try to update the file's modification time to match the 'last-modified'
             * response header value, if any.
             *
             * TODO: Decide what to do when res.statusCode is actually an error code (eg, 404), because
             * in such cases, the file content will likely just be an HTML error page.
             */
            done(null, res.statusCode);
        }).on('error', function(err) {
            done(err, res.statusCode);
        });
    });
};

/**
 * loadResource(sURL, fAsync, data, componentNotify, fnNotify, pNotify)
 *
 * Request the specified resource (sURL), and once the request is complete,
 * optionally call the specified method (fnNotify) of the specified component (componentNotify).
 *
 * TODO: Figure out how we can strongly type the fnNotify parameter, because the Closure Compiler has issues with:
 *
 *      {function(this:Component, string, (string|null), number, (number|string|null|Object|Array|undefined))} [fnNotify]
 *
 * NOTE: This function is a mirror image of the weblib version, for server-side component testing within Node;
 * since it is NOT intended for production use, it may make liberal use of synchronous functions, warning messages, etc.
 *
 * @param {string} sURL
 * @param {boolean} [fAsync] is true for an asynchronous request
 * @param {Object|null} [data] for a POST request (default is a GET request)
 * @param {Component} [componentNotify]
 * @param {function(...)} [fnNotify]
 * @param {number|string|null|Object|Array} [pNotify] optional fnNotify parameter
 * @return {Array} containing errorCode and responseText (empty array if async request)
 */
net.loadResource = function(sURL, fAsync, data, componentNotify, fnNotify, pNotify) {
    var nErrorCode = -1;
    var sResponse = null;
    if (net.isRemote(sURL)) {
        console.log('net.loadResource("' + sURL + '"): unimplemented');
    } else {
        if (!sServerRoot) {
            sServerRoot = path.join(path.dirname(fs.realpathSync(__filename)), "../../../");
        }
        var sBaseName = str.getBaseName(sURL);
        var sFile = path.join(sServerRoot, sURL);
        if (fAsync) {
            fs.readFile(sFile, {encoding: "utf8"}, function(err, s) {
                /*
                 * TODO: If err is set, is there an error code we should return (instead of -1)?
                 */
                if (!err) {
                    sResponse = s;
                    nErrorCode = 0;
                }
                if (fnNotify) {
                    if (!componentNotify) {
                        fnNotify(sBaseName, sResponse, nErrorCode, pNotify);
                    } else {
                        fnNotify.call(componentNotify, sBaseName, sResponse, nErrorCode, pNotify);
                    }
                }
            });
            return [];
        } else {
            try {
                sResponse = fs.readFileSync(sFile, {encoding: "utf8"});
                nErrorCode = 0;
            } catch(err) {
                /*
                 * TODO: If err is set, is there an error code we should return (instead of -1)?
                 */
                console.log(err.message);
            }
            if (fnNotify) {
                if (!componentNotify) {
                    fnNotify(sBaseName, sResponse, nErrorCode, pNotify);
                } else {
                    fnNotify.call(componentNotify, sBaseName, sResponse, nErrorCode, pNotify);
                }
            }
        }
    }
    return [nErrorCode, sResponse];
};

if (typeof module !== 'undefined') module.exports = net;