module.exports = function(config) {
	 config.set({
 		frameworks: ['browserify', 'jasmine'],
		files: [
			'src/**/*.js',
			'test/**/*_spec.js'
		],
		preprocessors: { 
			'test/**/*.js': ['jshint', 'browserify'],
			'src/**/*.js': ['jshint', 'browserify']
		},
		reporters: ['kjhtml', 'mocha'],
		browsers: ['PhantomJS'],
		browserify: {
			bundleDelay: 2000,
			debug: true
		}
	})
}