"use strict";

/*global require*/

var fs = require('fs');
var gulp = require('gulp');
var gutil = require('gulp-util');
var jsoncombine = require('gulp-jsoncombine');
//var generateSchema = require('generate-terriajs-schema');
var validateSchema = require('terriajs-schema');

var watching = false; // if we're in watch mode, we try to never quit.
var watchOptions = { poll:1000, interval: 1000 }; // time between watch intervals. OSX hates short intervals. Different versions of Gulp use different options.
var sourceDir = 'datasources';
var workDir = 'work';
var targetDir = 'build';

// Create the build directory, because browserify flips out if the directory that might
// contain an existing source map doesn't exist.

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir);
}

if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir);
}

gulp.task('build', ['render-datasource-templates', 'merge-datasources', 'list-ga-services']);
gulp.task('release', ['render-datasource-templates', 'merge-datasources', 'make-editor-schema', 'validate']);
gulp.task('watch', ['watch-datasource-templates', 'watch-datasources']);
gulp.task('default', ['build']);

gulp.task('merge-datasources', ['merge-catalog', 'merge-groups']);

gulp.task('list-ga-services', function(done) {
    var exec = require('child_process').exec;
    exec('./list_services.sh', function (err, stdout, stderr) {
        if (stderr)
            console.log(stderr);
        done(err);
    });
});

// Generate new schema for editor, and copy it over whatever version came with editor.
gulp.task('make-editor-schema', ['copy-editor'], function(done) {
/*    generateSchema({
        source: 'node_modules/terriajs',
        dest: 'wwwroot/editor',
        noversionsubdir: true,
        editor: true,
        quiet: true
    }).then(done);*/
});

/*gulp.task('copy-editor', function() {
    return gulp.src('./node_modules/terriajs-catalog-editor/**')
        .pipe(gulp.dest('./wwwroot/editor'));
});*/


// Generate new schema for validator, and copy it over whatever version came with validator.
gulp.task('make-validator-schema', function(done) {
    // Skip generation for now.
    done();
    /*generateSchema({
        source: 'node_modules/terriajs',
        dest: 'node_modules/terriajs-schema/schema',
        quiet: true
    }).then(done);*/
});

gulp.task('validate', ['merge-datasources', 'make-validator-schema'], function() {
    return validateSchema({
        terriajsdir: 'node_modules/terriajs',
        _: glob.sync([sourceDir + '/00_National_Data_Sets/*.json', sourceDir + '/*.json', '!' + sourceDir + '/00_National_Data_Sets.json', targetDir + '/*.json', '!' + targetDir + '/nm.json'])
    }).then(function(result) {
        if (result && !watching) {
            // We should abort here. But currently we can't resolve the situation where a data source legitimately
            // uses some new feature not present in the latest published TerriaJS.
            //process.exit(result);
        }
    });
});

gulp.task('watch-datasource-groups', ['merge-groups'], function() {
    watching = true;
    return gulp.watch(sourceDir + '/00_National_Data_Sets/*.json', watchOptions, [ 'merge-groups', 'merge-catalog' ]);
});

gulp.task('watch-datasource-catalog', ['merge-catalog'], function() {
    watching = true;
    return gulp.watch(sourceDir + '/*.json', watchOptions, [ 'merge-catalog' ]);
});

gulp.task('watch-datasources', ['watch-datasource-groups','watch-datasource-catalog']);


gulp.task('merge-groups', function() {
    var jsonspacing=0;
    return gulp.src(sourceDir + '/00_National_Data_Sets/*.json')
        .on('error', onError)
        .pipe(jsoncombine("00_National_Data_Sets.json", function(data) {
            // be absolutely sure we have the files in alphabetical order
            var keys = Object.keys(data).slice().sort();
            for (var i = 1; i < keys.length; i++) {
                data[keys[0]].catalog[0].items.push(data[keys[i]].catalog[0].items[0]);
            }
            return new Buffer(JSON.stringify(data[keys[0]], null, jsonspacing));
        }))
        .pipe(gulp.dest(workDir));
});

gulp.task('merge-catalog', ['merge-groups'], function() {
    var jsonspacing=0;
    return gulp.src([workDir + '/*.json', sourceDir + '/*.json'])
        .on('error', onError)
        .pipe(jsoncombine("nm.json", function(data) {
        // be absolutely sure we have the files in alphabetical order, with 000_settings first.
        var keys = Object.keys(data).slice().sort();
        data[keys[0]].catalog = [];

        for (var i = 1; i < keys.length; i++) {
            data[keys[0]].catalog.push(data[keys[i]].catalog[0]);
        }
        return new Buffer(JSON.stringify(data[keys[0]], null, jsonspacing));
    }))
    .pipe(gulp.dest(targetDir));
});

/*
    Use EJS to render "datasources/foo.ejs" to "wwwroot/init/foo.json". Include files should be
    stored in "datasources/includes/blah.ejs". You can refer to an include file as:

    <%- include includes/foo %>

    If you want to pass parameters to the included file, do this instead:

    <%- include('includes/foo', { name: 'Cool layer' } %>

    and in includes/foo:

    "name": "<%= name %>"
 */
gulp.task('render-datasource-templates', function() {
    var ejs = require('ejs');
    var JSON5 = require('json5');
    var templateDir = 'datasources';
    try {
        fs.accessSync(templateDir);
    } catch (e) {
        // Datasources directory doesn't exist? No problem.
        return;
    }
    fs.readdirSync(templateDir).forEach(function(filename) {
        if (filename.match(/\.ejs$/)) {
            var templateFilename = path.join(templateDir, filename);
            var template = fs.readFileSync(templateFilename,'utf8');
            var result = ejs.render(template, null, {filename: templateFilename});

            // Remove all new lines. This means you can add newlines to help keep source files manageable, without breaking your JSON.
            // If you want actual new lines displayed somewhere, you should probably use <br/> if it's HTML, or \n\n if it's Markdown.
            //result = result.replace(/(?:\r\n|\r|\n)/g, '');

            var outFilename = filename.replace('.ejs', '.json');
            try {
                // Replace "2" here with "0" to minify.
                result = JSON.stringify(JSON5.parse(result), null, 2);
                console.log('Rendered template ' + outFilename);
            } catch (e) {
                console.warn('Warning: Rendered template ' + outFilename + ' is not valid JSON');
            }
            fs.writeFileSync(path.join('wwwroot/init', outFilename), new Buffer(result));
        }
    });

});

gulp.task('watch-datasource-templates', ['render-datasource-templates'], function() {
    return gulp.watch(['datasources/**/*.ejs','datasources/*.json'], watchOptions, [ 'render-datasource-templates' ]);
});



function onError(e) {
    gutil.log(e.message);
    if (!watching) {
        process.exit(1);
    }
}
