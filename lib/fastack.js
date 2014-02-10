var program = require('commander')
	, fs = require('fs')
	, ProgressBar = require('progress')
	, colors = require('colors')
	, DDPClient = require('ddp')
	, when = require('when')
	, fn = require('when/function')
	, prompt = require('prompt')
	, request = require('request')
	, path = require('path')
;

// Get the version of the CLI from package.json
var version = require('../package.json').version;

program
	.version(version)

/*
	Functions to standardize and handle output to nicely
*/
function writeError(error) {
	console.log('error: '.red + ' ' + error.message);
	// console.log(error.stack)
}

function writeSuccess(message) {
	console.log('success: '.green + ' ' + message);
}

function writeNote(note) {
	console.log('note: '.yellow + ' ' + note);
}

/*
	Instantiate a new DDPClient and connect to our application server
*/
	var ddpclient = new DDPClient({
		host: 'localhost',
		port: 3000,
		use_json: true
	});


/*
	Walk a directory asynchronously and recurse into subfolders. Helper function. Calls back with array of file paths.
	http://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search

	* 'dir' |String| path to directory you want to recurse through
	* 'iterator' |Function| is called with (filepath), every time a file or directory is discovered
	* 'done' |Function| is called with (error, array of file paths)
*/
function recurse(dir, iterator, done) {
	var results = [];
	fs.readdir(dir, function(err, list) {
		if (err) return done(err);
		var pending = list.length;
		if (!pending) return done(null, results);
		list.forEach(function(file) {
			file = dir + '/' + file;
			fs.stat(file, function(err, stat) {
				if (stat && stat.isDirectory()) {
					recurse(file, iterator, function(err, res) {
						results = results.concat(res);
						iterator(file);
						if (!--pending) done(null, results);
					})
				}
				else {
					results.push(file);
					iterator(file);
					if (!--pending) done(null, results);
				}
			})
		})
	})
}

/* 
	Recurse through a directory and compress it into one file for upload:

	* 'directory' |String| is the directory to be compressed
	* 'acceptableFiles' |Array[Strings]| list of acceptable file extensions to package
	* 'ignoreDirectories' |Array[Strings]| list of directories to ignore from package
*/
function packageApp(directory, acceptableFiles, ignoreDirectories) {
	var   archiver = require('archiver')
		, zlib = require('zlib')
		, gzipper = zlib.createGzip()
		, target = directory + '/fastack-deploy-package.tar.gz'
		, output = fs.createWriteStream(target)
		, archive = archiver('tar')
		, deferred = when.defer();
		;

	// archive.on('close', function() {

	// })

	archive.on('error', function(err) {
	  throw err;
	});

	archive.pipe(gzipper).pipe(output);

	recurse(directory, function(file) {
		/*
		Use readFileSync for now instead of createReadStream,
		uses more memory but won't hit a too many files open error for directories with many files.
		On the other hand, createReadStream uses less memory. If user has a particularly large file that won't fit in memory
		that they need to upload, this may fail. This seems unlikely at the moment.

		TODO: refactor to a "smart" createReadStream that avoids hitting that file open limit by retrying on error
			try this guy: https://github.com/isaacs/node-graceful-fs
		*/


		if (fs.statSync(file).isFile()) {
			// do some simple client-side validation to only allow certain file types in the package
			var ext = path.extname(file);
			// if file extension is allowed
			if (acceptableFiles.indexOf(ext) != -1) // checks if `ext` is in array `acceptableFiles`
				archive.append(fs.readFileSync(file), { name: file })
		}


	}, function(err, files) {
		if (err) deferred.reject(err);;
		archive.finalize(function(err, bytes) {
			if (err) deferred.reject(err);
		  	else {
				writeSuccess('compressed ' + files.length + ' app files.')
				deferred.resolve(target);
		  }
		});
	});

	return deferred.promise;
}

/*
	Generate a config file and configure a directory
*/
function configureDirectory(dir) {
	// check if the directory exists before proceeding
	if (fs.existsSync(dir)) {
		if (fs.existsSync(dir+'/fastack.json')) {
			// if there is, store the config information
			try {
				config = JSON.parse(fs.readFileSync(dir+'/fastack.json'));
				return config;
			}
			catch(err) {
				throw new Error("Problem parsing json in: " + dir +'/fastack.json. ' + err.message)
			}
		}
		else {
			// TODO: figure out what to do if no config
		}
	} else {
		throw new Error('Directory ' + dir + ' does not exist!')
	}

}

/*
	Connect to app server
*/
function connectFastack() {
	var deferred = when.defer();

	ddpclient.connect(function(err) {
		if (err) deferred.reject(err);
		else deferred.resolve();
	})

	return deferred.promise;
}

/*
	Get deployment configuration options from app server
*/
function getDeployConfig() {
	var deferred = when.defer();

	ddpclient.call('getDeployConfig', [], function(err, deployConfig) {
		if (err) deferred.reject(err)
		else deferred.resolve(deployConfig)
	})

	return deferred.promise;
}

/*
	Authenticate to app server
*/
function authDDP(token) {
	var deferred = when.defer();

	var callback = function(err, result) {
		if (err) deferred.reject(err)
		else {
			writeSuccess('authenicated!')
			console.log(result)
			deferred.resolve(result)
		}
	}

	if (token){
		ddpclient.loginWithToken(token, callback);
	}
	else {
		// start the prompt
		prompt.message = 'login to Fastack';
		prompt.start();
		var schema = {
			properties: {
				username: {
					description: 'username',
					required: true
				},
				password: {
					description: 'password',
					hidden: true,
					required: true
				}
			}
		}
		prompt.get(schema, function(err, result) {
			if (err) deferred.reject(err);
			else {
				ddpclient.loginWithUsername(result.username, result.password, callback);
			}
		})
	}

	return deferred.promise;
}

/*
	Lookup what the latest version of the CLI is from app server
*/
function latestVersion() {
	var deferred = when.defer();
	connectFastack()
	.then(function() {
		ddpclient.call('getCliVersion', [], function(err, version) {
			if (err) deferred.reject(err);
			else deferred.resolve(version);
			ddpclient.close();
		})
	})
	return deferred.promise;
}

latestVersion().then(function(latest) {
	if (version !== latest) {
		writeError(new Error('this is not the latest version of the `fastack` command line utility. Please update via NPM to avoid conflicts.'))
		writeNote('installed version: ' + version)
		writeNote('latest version: ' + latest)
		writeNote('halting execution')
		writeNote('[sudo] npm install -g fastack')
		process.exit(0);
	}
})

/*
	Command to create a local app
*/
program
	.command('create [app_name]')
	.description('create an app')
	.action(function() {
		
	})

/*
	Command to deploy a directory to an app
*/
program
	.command('deploy [dir]')
	.description('deploy a directory to a fastack app')
	.option("-a, --app [appname]", "Which app to deploy to")
	.action(function(dir, options) {
		// determine path for app directory.

		// if no directory is specified, make it the current working directory
		if (!dir)
			dir = process.cwd();
		// if a relative path is specifed, build absolute path
		if (!(dir.charAt(0) === '/'))
			dir = process.cwd() + '/' + dir;
		// if the last character in the path is a slash, drop it
		if (dir.charAt(dir.length-1) === '/')
			dir = dir.substring(0, dir.length-1)

		// declare an object to hold variables which need to exist between promises
		var vars = {};
	
		// configure and validate the directory
		fn.call(configureDirectory, dir)

		// initiate DDP connection with app server
		.then(function(appConfig){
			vars.appConfig = appConfig;
			return connectFastack();
		})

		// get deployment configuration options from our app server
		.then(function(){
			return getDeployConfig();
		})

		// package the app, passing in the necessary deployment configurations to the packager
		.then(function(deployConfig) {
			vars.deployConfig = deployConfig;
			return packageApp(dir, deployConfig.acceptableFiles, deployConfig.ignoreDirectories);
		})

		.then(function(target) {
			vars.target = target;
			return authDDP(vars.appConfig.token);
		})

		// close connection to the app server
		.then(function() {
			ddpclient.close();
		})


		// handle errors
		.then(function() {}, function(error) {
			// make sure ddpclient closes
			ddpclient.close()
			writeError(error)
		})
	})
	;


program.parse(process.argv);