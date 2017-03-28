'use strict';

var _ = require('lodash');

function initWatchVal() { }

function Scope() {
	this.$$watchers = [];
	this.$$lastDirtyWatch = null;
	this.$$asyncQueue = [];
	this.$$applyAsyncQueue = [];
	this.$$applyAsyncId = null;
	this.$$postDigestQueue = [];
	this.$$phase = null;
}

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq){
	if (valueEq) {
		return _.isEqual(newValue, oldValue);
	} else { 
		return newValue === oldValue || 
			(typeof newValue === 'number' && typeof oldValue === 'number' && 
				isNaN(newValue) && isNaN(oldValue));
	}
};

Scope.prototype.$beginPhase = function(phase) {
	if (this.$$phase) {
		throw this.$$phase + ' already in progress.';
	}
	this.$$phase = phase;
};

Scope.prototype.$clearPhase = function() {
	this.$$phase = null;
};


Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
	var self = this;
	var watcher = {
		watchFn: watchFn,
		listenerFn: listenerFn || function() { },
		valueEq: !!valueEq,
		last: initWatchVal
	};
	this.$$watchers.unshift(watcher);   
	this.$$lastDirtyWatch = null;
	return function() {    //returns function to destroy watch
		var index = self.$$watchers.indexOf(watcher);
		if (index >= 0) {
			self.$$watchers.splice(index, 1);
			self.$$lastDirtyWatch = null;
		}
	};
};

Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
	var self = this;
	var newValues = new Array(watchFns.length);
	var oldValues = new Array(watchFns.length);
	var changeReactionScheduled = false;
	var firstRun = true;

	function watchGroupListener() {
		if (firstRun) {
			listenerFn(newValues, newValues, self);
			firstRun = false;
		} else {
			listenerFn(newValues, oldValues, self);
		}
		changeReactionScheduled = false;
	}

	_.forEach(watchFns, function(watchFn, i) {
		self.$watch(watchFn, function(newValue, oldValue) {
			newValues[i] = newValue;
			oldValues[i] = oldValue;
			if (!changeReactionScheduled) {
				changeReactionScheduled = true;
				self.$evalAsync(watchGroupListener);
			}
		});
	});
};


Scope.prototype.$$digestOnce = function() {
	var self = this;
	var newValue, oldValue, dirty;
	_.forEachRight(this.$$watchers, function(watcher){
		try {
			if(watcher) {
				newValue = watcher.watchFn(self); // gets the value we're watching
				oldValue = watcher.last; 
				if (!self.$$areEqual(newValue, oldValue, watcher.valueEq)) {
					self.$$lastDirtyWatch = watcher;
					watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
					watcher.listenerFn(newValue, 
						(oldValue === initWatchVal ? newValue : oldValue), 
						self);
					dirty = true;
				} else if (self.$$lastDirtyWatch === watcher) {
					return false;
				}
			}
		} catch (e) {
			console.log(e);
		}
	});
	return dirty;
};

Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	this.$$lastDirtyWatch = null;
	this.$beginPhase('$digest');

	if (this.$$applyAsyncId) {
		clearTimeout(this.$$applyAsyncId);
		this.$$flushApplyAsync();
	}

	do {
		while (this.$$asyncQueue.length) {
			try {
				var asyncTask = this.$$asyncQueue.shift();
				asyncTask.scope.$eval(asyncTask.expression);
			}	catch (e) {
				console.log(e);
			}
		}		
		dirty = this.$$digestOnce(); 
		if ((dirty || this.$$asyncQueue.length) && !(ttl--)) {
			this.$clearPhase();
			throw '10 digest iterations reached';
		}
	} while (dirty || this.$$asyncQueue.length);
	this.$clearPhase();

	while (this.$$postDigestQueue.length) {
		try {
			this.$$postDigestQueue.shift()();
		} 	catch (e) {
			console.log(e);
		}
	}
};

Scope.prototype.$apply = function(expr) {
	try {
		this.$beginPhase('$apply');
		return this.$eval(expr); 
	} finally {
		this.$clearPhase();
		this.$digest();
	}
};

Scope.prototype.$applyAsync = function(expr) {
	var self = this;
	self.$$applyAsyncQueue.push(function() {
		self.$eval(expr);
	});

	if (self.$$applyAsyncId === null) {
		self.$$applyAsyncId = setTimeout(function() {
			self.$apply(self.$$flushApplyAsync.bind(self));
		}, 0);
	}

};

Scope.prototype.$$flushApplyAsync = function() {
	while (this.$$applyAsyncQueue.length) {
		try {
			this.$$applyAsyncQueue.shift()();
		} catch (e) {
			console.log(e);
		}
	}
	this.$$applyAsyncId = null;
};

Scope.prototype.$eval = function(expr, locals) {
	return expr(this, locals);
};

Scope.prototype.$evalAsync = function(expr) {
	var self = this;
	if (!self.$$phase && !self.$$asyncQueue.length) {
		setTimeout(function() {
			if (self.$$asyncQueue.length) {
				self.$digest();
			}
		}, 0);
	}
	this.$$asyncQueue.push({scope: this, expression: expr});
};

Scope.prototype.$$postDigest = function(fn) {
	this.$$postDigestQueue.push(fn);
};


module.exports = Scope;