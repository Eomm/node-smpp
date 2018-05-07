const net = require('net');
const tls = require('tls');
const util = require('util');
const parse = require('url').parse;
const defs = require('../defs');
const PDU = require('../pdu').PDU;
const { EventEmitter } = require('events');

class Session extends EventEmitter {

  constructor(options) {
    super();
    this.options = options || {};
    var transport = net;
    this.sequence = 0;
    this.paused = false;
    this._busy = false;
    this._callbacks = [];

    if (options.socket) {
      this.socket = options.socket;
    } else {
      if (options.tls) {
        transport = tls;
      }
      this.socket = transport.connect(this.options);
      this.socket.on('connect', () => { this.emit('connect'); });
      this.socket.on('secureConnect', () => { this.emit('secureConnect'); });
    }

    this.socket.on('readable', () => { this._extractPDUs() });
    this.socket.on('close', () => { this.emit('close'); });
    this.socket.on('error', (e) => { this.emit('error', e); });
  }

  connect() {
    this.sequence = 0;
    this.paused = false;
    this._busy = false;
    this._callbacks = [];
    this.socket.connect(this.options);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this._extractPDUs();
  }

  close(callback) {
    if (callback) {
      this.socket.once('close', callback);
    }
    this.socket.end();
  }

  send(pdu, responseCallback, sendCallback) {
    if (!this.socket.writable) {
      return false;
    }
    if (!pdu.isResponse()) {
      // when server/session pair is used to proxy smpp
      // traffic, the sequence_number will be provided by
      // client otherwise we generate it automatically
      if (!pdu.sequence_number) {
        if (this.sequence == 0x7FFFFFFF) {
          this.sequence = 0;
        }
        pdu.sequence_number = ++this.sequence;
      }

      if (responseCallback) {
        this._callbacks[pdu.sequence_number] = responseCallback;
      }
    } else if (responseCallback && !sendCallback) {
      sendCallback = responseCallback;
    }
    this.socket.write(pdu.toBuffer(), () => {
      this.emit('send', pdu);
      if (sendCallback) {
        sendCallback(pdu);
      }
    });
    return true;
  }

  _extractPDUs() {
    if (this._busy) {
      return;
    }
    this._busy = true;
    var pdu;
    while (!this.paused) {
      try {
        if (!(pdu = PDU.fromStream(this.socket))) {
          break;
        }
      } catch (e) {
        this.emit('error', e);
        return;
      }
      this.emit('pdu', pdu);
      this.emit(pdu.command, pdu);
      if (pdu.isResponse() && this._callbacks[pdu.sequence_number]) {
        this._callbacks[pdu.sequence_number](pdu);
        delete this._callbacks[pdu.sequence_number];
      }
    }
    this._busy = false;
  }
}


const createShortcut = function (command) {
  return function (options, responseCallback, sendCallback) {
    if (typeof options == 'function') {
      sendCallback = responseCallback;
      responseCallback = options;
      options = {};
    }
    var pdu = new PDU(command, options);
    return this.send(pdu, responseCallback, sendCallback);
  };
};

for (var command in defs.commands) {
  Session.prototype[command] = createShortcut(command);
}

module.exports = Session;

module.exports.addCommand = function (command, options) {
  options.command = command;
  defs.commands[command] = options;
  defs.commandsById[options.id] = options;
  Session.prototype[command] = createShortcut(command);
};