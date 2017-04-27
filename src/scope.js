'use strict';

var _ = require('lodash');

function initWatchVal() { }

function Scope() {
	this.$$asyncQueue = [];
	this.$$applyAsyncQueue = [];
	this.$$applyAsyncId = null;
	this.$$children = [];
	this.$$lastDirtyWatch = null;
	this.$$postDigestQueue = [];
	this.$$phase = null;
	this.$root = this;
	this.$$watchers = [];
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
	this.$root.$$lastDirtyWatch = null;
	return function() {    //returns function to destroy watch
		var index = self.$$watchers.indexOf(watcher);
		if (index >= 0) {
			self.$$watchers.splice(index, 1);
			self.$root.$$lastDirtyWatch = null;
		}
	};
};

Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
	var self = this;
	var newValues = new Array(watchFns.length);
	var oldValues = new Array(watchFns.length);
	var changeReactionScheduled = false;
	var firstRun = true;

	if(watchFns.length === 0) {
		var shouldCall = true;
		
		self.$evalAsync(function() { 
			if (shouldCall) {
				listenerFn(newValues, oldValues, self);
			}
		}); 
		return function() {
			shouldCall = false;
		};
	}

	function watchGroupListener() {
		if (firstRun) {
			listenerFn(newValues, newValues, self);
			firstRun = false;
		} else {
			listenerFn(newValues, oldValues, self);
		}
		changeReactionScheduled = false;
	}

	var destroyFunctions = _.map(watchFns, function(watchFn, i) {
		return self.$watch(watchFn, function(newValue, oldValue) {
			newValues[i] = newValue;
			oldValues[i] = oldValue;
			if (!changeReactionScheduled) {
				changeReactionScheduled = true;
				self.$evalAsync(watchGroupListener);
			}
		});
	});

	return function() {
		_.forEach(destroyFunctions, function(destroyFunction) {
			destroyFunction();
		});
	};
};

Scope.prototype.$$everyScope = function(fn) {
	if (fn(this)) {
		return this.$$children.every(function(child) {
			return child.$$everyScope(fn);
		});
	} else {
		return false;
	}
};

Scope.prototype.$$digestOnce = function() {
	var dirty;
	var continueLoop = true;
	var self = this;

	this.$$everyScope(function(scope) {
		var newValue, oldValue;
		_.forEachRight(scope.$$watchers, function(watcher){
			try {
				if(watcher) {
					newValue = watcher.watchFn(scope); // gets the value we're watching
					oldValue = watcher.last; 
					if (!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
						scope.$root.$$lastDirtyWatch = watcher;
						watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
						watcher.listenerFn(newValue, 
							(oldValue === initWatchVal ? newValue : oldValue), 
							scope);
						dirty = true;
					} else if (scope.$root.$$lastDirtyWatch === watcher) {
						continueLoop = false;
						return false;
					}
				}
			} catch (e) {
				console.log(e);
			}
		});
		return continueLoop;
	});
	return dirty;
};

Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	this.$root.$$lastDirtyWatch = null;
	this.$beginPhase('$digest');

	if (this.$root.$$applyAsyncId) {
		clearTimeout(this.$root.$$applyAsyncId);
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
		this.$root.$digest();
	}
};

Scope.prototype.$applyAsync = function(expr) {
	var self = this;
	self.$$applyAsyncQueue.push(function() {
		self.$eval(expr);
	});

	if (self.$root.$$applyAsyncId === null) {
		self.$root.$$applyAsyncId = setTimeout(function() {
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
				self.$root.$digest();
			}
		}, 0);
	}
	this.$$asyncQueue.push({scope: this, expression: expr});
};

Scope.prototype.$$postDigest = function(fn) {
	this.$$postDigestQueue.push(fn);
};

Scope.prototype.$new = function(isolated, parent) {
	var child;
	parent = parent || this;
	if(isolated) {
		child = new Scope();
		child.$root = parent.$root;
		child.$$asyncQueue = parent.$$asyncQueue;
		child.$$postDigestQueue = parent.$$postDigestQueue;
		child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
	} else {
		var ChildScope = function() { };
		ChildScope.prototype = this;
		child = new ChildScope();
	}	
	parent.$$children.push(child);
	child.$$watchers = [];
	child.$$children = [];
	child.$parent = parent;
	return child;
};

Scope.prototype.$destroy = function() {
	if (this.$parent) {
		var siblings = this.$parent.$$children;
		var indexOfThis = siblings.indexOf(this);
		if (indexOfThis >= 0) {
			siblings.splice(indexOfThis, 1);
		}
	}
	this.$$watchers = null;
};


module.exports = Scope;