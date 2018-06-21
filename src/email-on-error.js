var nodemailer = require("nodemailer");
var fs = require("fs");
var child_process = require("child_process");

if (process.argv.length <= 3) {
	console.log("Usage: <e-mail config> <command> [arguments...]");
	console.log("Usage: email.json echo hello world");
	process.exit(0);
}
var config = JSON.parse(fs.readFileSync(process.argv[2]).toString());

var mail_config = {
	"host": config.host,
	"port": config.port,
	"secure": {
		"no": false,
		"yes": true
	}[config.ssl[0]],
	"name": config.domain,
	"tls": {
		"rejectUnauthorized": false
	}
};
switch (config.authentication[0]) {
	case "none":
		break;
	case "login":
		mail_config["auth"] = {
			"user": config.authentication[1].username,
			"pass": config.authentication[1].password
		};
		break;
	default:
		throw new Error("config authentication must be none|login");
}
var mail_transport = nodemailer.createTransport(mail_config);

var command = process.argv[3];
var command_arguments = process.argv.filter(function ($, i) {
	return i > 3;
});
function quoteIfRequired(string) {
	if (string.indexOf(" ") >= 0 || string.indexOf("\"") >= 0 || string.indexOf("'") >= 0 || string.indexOf("\\") >= 0) {
		return "\"" + string.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/'/g, "\\\'") + "\"";
	} else {
		return string;
	}
}
var command_string = "'" + quoteIfRequired(command) + command_arguments.map(function(argument) { return " " + quoteIfRequired(argument); }).join("") + "'";

function sendMail(title, body, onSend) {
	var start = new Date().toUTCString();
	try {
		mail_transport.sendMail({
			"from": config.from,
			"to": Object.keys(config.to).join(", "),
			"subject": config["subject prefix"] + title,
			"text": body,
			"html": "<!DOCTYPE html>\n" +
				"<html>\n" +
				"  <head>\n" +
				"    <meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" />\n" +
				"  </head>\n" +
				"  <body>" + body
				               .replace(/&/g, "&amp;")
				               .replace(/</g, "&lt;")
				               .replace(/>/g, "&gt;")
				               .replace(/"/g, "&quot;")
				               .replace(/'/g, "&#039;")
				               .replace(/\n(\r)?/g, "<br />") +
				  "</body>\n" +
				"</html>"
		}, function (error) {
			if (error) {
				var end = new Date().toUTCString();
				console.error("\033[31m[mail-on-err] [FAILED] sending e-mail \"" + title + "\" @ " + start + " - " + end + ", due to error: " + error + "\033[39m");
			}
			onSend();
		});
	} catch (e_email) {
		var end = new Date().toUTCString();
		console.error("\033[31m[mail-on-err] [FAILED] sending e-mail \"" + title + "\" @ " + start + " - " + end + ", due to exception:");
		console.error(e_email);
		process.stderr.write("\033[39m");
	}
}

try {
	var child = child_process.spawn(
		command,
		command_arguments,
		{
			"env": JSON.parse(JSON.stringify(process.env)) // force object clone
		}
	);
} catch (e) {
	console.error("\033[31m[mail-on-err] Cannot spawn child process " + command_string + " due to exception:", e);
	process.stderr.write("\033[39m");
	process.exit(1);
}
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);

child.stderr.on("data", function (data) {
	process.stderr.write(data);

	sendMail("[ERROR] Stderr from command " + command_string + " @ " + new Date().toUTCString(), data.toString("utf-8"), function () {});
});

child.on("exit", function (code, signal) {
	process.exitCode = code;
	process.stdin.end(); // this would otherwise block nodejs from exiting

	if (code !== 0) {
		console.error("\033[31m[mail-on-err] Child process " + command_string + " exited with non-zero exit code (" + code + ")" + (signal === null ? ", no signal" : ", signal (" + signal + ")") + " @ " + new Date().toUTCString() + "\033[39m");
		sendMail("[ERROR] Process " + command_string + " exited with non-zero exit code @ " + new Date().toUTCString(), "Process exited with non-zero exit code\n\nExit code: " + code + "\nSignal: " + (signal === null ? "no signal" : signal), function () {});
	}
});

child.on("error", function (err) {
	console.error("\033[31m[mail-on-err] Child process " + command_string + " error code (" + err.code + ") @ " + new Date().toUTCString());
	console.error(err);
	process.stderr.write("\033[39m");
	sendMail("[ERROR] Process " + command_string + " error code (" + err.code + ") @ " + new Date().toUTCString(), "Process error:\n" + err, function () {
		process.exit(1);
	});
});

process.on("uncaughtException", function (err) {
	console.error("\033[31m[mail-on-err] Uncaught error running child process " + command_string + " @ " + new Date().toUTCString() + ":", err, "\033[39m");
	sendMail("[ERROR] Uncaught error running process " + command_string + " @ " + new Date().toUTCString(), err.toString(), function () {
		process.exit(1);
	});

	child.kill();
});

["SIGINT"].forEach(function (signal) {
	process.on(signal, function () {
		console.log("[mail-on-err] Received signal " + signal + " and sending to child process.");
		child.kill(signal);
	});
});