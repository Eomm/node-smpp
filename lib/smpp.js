const net = require('net');
const	tls = require('tls');
const util = require('util');
const parse = require('url').parse;
const defs = require('./defs');
const PDU = require('./pdu').PDU;

const Session = require('./models/session');

function Server(options, listener) {
	var self = this;
	this.sessions = [];

	if (typeof options == 'function') {
		listener = options;
		options = {};
	} else {
		options = options || {};
	}

	if (listener) {
		this.on('session', listener);
	}

	this.tls = options.key && options.cert;
	var transport =  this.tls ? tls : net;

	transport.Server.call(this, options, function(socket) {
		var session = new Session({socket: socket});
		session.server = self;
		self.sessions.push(session);
		socket.on('close', function() {
			self.sessions.splice(self.sessions.indexOf(session), 1);
		});
		self.emit('session', session);
	});
}

util.inherits(Server, tls.Server);

Server.prototype.listen = function() {
	var args = [this.tls ? 3550 : 2775];
	if (typeof arguments[0] == 'function') {
		args[1] = arguments[0];
	} else if (arguments.length > 0) {
		args = arguments;
	}
	return tls.Server.prototype.listen.apply(this, args);
};

exports.createServer = function(options, listener) {
	return new Server(options, listener);
};

exports.connect = exports.createSession = function(url, listener) {
	var options = {};

	if (arguments.length > 1 && typeof listener != 'function') {
		options = {
			host: url,
			port: listener
		};
		listener = arguments[3];
	} else if (typeof url == 'string') {
		options = parse(url);
		options.host = options.slashes ? options.hostname : url;
		options.tls = options.protocol == 'ssmpp:';
	} else if (typeof url == 'function') {
		listener = url;
	} else {
		options = url || {};
		if (options.url) {
			url = parse(options.url);
			options.host = url.hostname;
			options.port = url.port;
			options.tls = url.protocol == 'ssmpp:';
		}
	}
	options.port = options.port || (options.tls ? 3550 : 2775);

	var session = new Session(options);
	if (listener) {
		session.on(options.tls ? 'secureConnect' : 'connect', listener);
	}

	return session;
};

exports.addTLV = function(tag, options) {
	options.tag = tag;
	defs.tlvs[tag] = options;
	defs.tlvsById[options.id] = options;
};

exports.Server = Server;
exports.PDU = PDU;
for (var key in defs) {
	exports[key] = defs[key];
}
for (var error in defs.errors) {
	exports[error] = defs.errors[error];
}
for (var key in defs.consts) {
	exports[key] = defs.consts[key];
}
