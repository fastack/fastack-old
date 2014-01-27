var program = require('commander')
	, fs = require('fs')
	, ProgressBar = require('progress')
	, colors = require('colors')
	, humanize = require('humanize')
;

program
	.version('0.0.1')

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
	* 'callback' |Function| is called with (error, path of compressed file)
*/
function packageApp(directory, callback) {
	var   archiver = require('archiver')
		, zlib = require('zlib')
		, gzipper = zlib.createGzip()
		, target = directory + '/fastack-deploy-package.tar.gz'
		, output = fs.createWriteStream(target)
		, archive = archiver('tar')
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
			https://github.com/isaacs/node-graceful-fs
		*/

		if (fs.statSync(file).isFile()) archive.append(fs.readFileSync(file), { name: file });


	}, function(err, files) {
		if (err) throw err;
		archive.finalize(function(err, bytes) {
		  if (err) throw err;
		  callback(null, files, target);
		});
	});
}

/*
	Command to deploy a directory to an app
*/
program
	.command('deploy [dir]')
	.description('deploy a directory to a fastack app')
	.option("-a, --app [appname]", "Which app to deploy to")
	.action(function(dir, options) {
		dir = (dir) ? './' + dir : './';
		if (fs.existsSync(dir)) {
			packageApp(dir, function(err, files, target) {
				if (err) throw err
				var message = 'Compressed ' + files.length + ' files into a ' + humanize.filesize(fs.statSync(target).size) + ' archive.';
				console.log(message.green);
			})
		}
		else {
			var message = 'Directory ' +dir.substring(2)+ ' does not exist!';
			console.error(message.red);
		}
	});


program.parse(process.argv);