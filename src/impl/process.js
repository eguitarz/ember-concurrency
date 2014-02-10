var dispatch = require("./dispatch");
var select = require("./select");

var FnHandler = function(f) {
  this.f = f;
};

FnHandler.prototype.is_active = function() {
  return true;
};

FnHandler.prototype.commit = function() {
  return this.f;
};

function put_then_callback(channel, value, callback) {
  var result = channel._put(value, new FnHandler(callback));
  if (result) {
    callback(result.value);
  }
}

function take_then_callback(channel, callback) {
  var result = channel._take(new FnHandler(callback));
  if (result) {
    callback(result.value);
  }
}

var Process = function(gen, onFinish) {
  this.gen = gen;
  this.finished = false;
  this.onFinish = onFinish;
};

var Instruction = function(op, data) {
  this.op = op;
  this.data = data;
};

var TAKE = "take";
var PUT = "put";
var WAIT = "wait";
var ALTS = "alts";
var STOP = "stop";

// TODO FIX XXX: This is a (probably) temporary hack to avoid blowing
// up the stack, but it means double queueing when the value is not
// immediately available
Process.prototype._continue = function(response) {
  var self = this;
  dispatch.run(function() {
    self.run(response);
  });
};

Process.prototype._done = function(value) {
  if (!this.finished) {
    this.finished = true;
    var onFinish = this.onFinish;
    if (typeof onFinish === "function") {
      dispatch.run(function() {
        onFinish(value);
      });
    }
  }
};

Process.prototype.run = function(response) {
  if (this.finished) {
    return;
  }

  // TODO: Shouldn't we (optionally) stop error propagation here (and
  // signal the error through a channel or something)? Otherwise the
  // uncaught exception will crash some runtimes (e.g. Node)
  var iter = this.gen.next(response);
  if (iter.done) {
    this._done(undefined);
    return;
  } else {
    var instruction = iter.value;
  }

  var self = this;

  switch (instruction.op) {
  case STOP:
    this._done(instruction.data);
    break;

  case PUT:
    var data = instruction.data;
    put_then_callback(data.channel, data.value, function(ok) {
      self._continue(ok);
    });
    break;

  case TAKE:
    var channel = instruction.data;
    take_then_callback(channel, function(value) {
      self._continue(value);
    });
    break;

  case WAIT:
    var msecs = instruction.data;
    dispatch.queue_delay(function() {
      self.run(null);
    }, msecs);
    break;

  case ALTS:
    select.do_alts(instruction.data.operations, function(result) {
      self._continue(result);
    }, instruction.data.options);
    break;
  }

};

function take(channel) {
  return new Instruction(TAKE, channel);
}

function put(channel, value) {
  return new Instruction(PUT, {
    channel: channel,
    value: value
  });
}

function wait(msecs) {
  return new Instruction(WAIT, msecs);
}

function alts(operations, options) {
  return new Instruction(ALTS, {
    operations: operations,
    options: options
  });
}

function stop(value) {
  return new Instruction(STOP, value);
}

exports.put_then_callback = put_then_callback;
exports.take_then_callback = take_then_callback;
exports.put = put;
exports.take = take;
exports.wait = wait;
exports.alts = alts; exports.DEFAULT = select.DEFAULT;
exports.stop = stop;

exports.Process = Process;