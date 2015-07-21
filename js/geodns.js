#!/usr/bin/nodejs
//Program is a self-executing anonymous function with all dependencies (modules, global API calls, etc) explicitly
//defined in function parameters.
(function (dep_https_module,       //https module for calling Google Geolocation API
           dep_settings_json,      //Settings json file for fetching Google Geolocation API API key.
           dep_syslog_module,       //Logging errors and notices
           dep_store_function,     //Storing the results.
           dep_json_module,        //Json module
           dep_math_module,        //Math module needed to call floor.
           dep_dns_module,         //Dns module, we are a simple DNS server.
           dep_now_function,       //Simple function for fething a 'now' Date object.
           dep_parseint_builtin,   //The parseInt builtin (yes, builtins are still dependencies).
           dep_setinterval_builtin,//The setInterval builtin
           dep_isnan_builtin,      //The isNaN builtin
           dep_dictlen_function) { //Function for determining dictionary length.
    'use strict';
    //Google Geolocation API object literal.
    var googleapi = {
            "apikey" : process.env.API_GOOGLE,
            "server" : null,
            //Object won't work unless API key is set first.
            "setkey" : function (key) {
                googleapi.apikey = key;
            },
            //Main function takes a prepped sensor/wifiAccessPoints array.
            "lookupmac" : function (sensor, wifiaccespoints) {
                var requesturi = '/geolocation/v1/geolocate?key=' + googleapi.apikey,
                    obj = { "wifiAccessPoints" : wifiaccespoints},
                    jsondata = dep_json_module.stringify(obj),
                    options = {
                        hostname: "www.googleapis.com",
                        port: 443,
                        path: requesturi,
                        method: "POST",
                        headers : {
                            'Host':  "www.googleapis.com",
                            "Content-Type" : "application/json",
                            "Content-length" : jsondata.length
                        }
                    },
                    request,
                    body = '';
                request = dep_https_module.request(options, function (res) {
                    res.setEncoding('utf8');
                    res.on('data', function (chunk) {
                        body = body + chunk;
                    });
                    res.on('end', function () {
                        var result = dep_json_module.parse(body);
                        //Add the original sensor/wifiAccessPoints array to the result so we get one object.
                        result.measurements = wifiaccespoints;
                        result.sensorname = sensor;
                        //Also add the time that Google responded.
                        result.flushtimestamp = dep_now_function().toISOString();
                        //For now log to the console, this should go to a database so we can create a KML from it later.
                        dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Response received from Google Geoloacation API.");
                        dep_store_function(dep_json_module.stringify(result));
                    });
                });
                request.on('error', function (e) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Problem with request:" + e.message);
                });
                request.write(jsondata);
                request.end();
            }
        },
        //Tempstore object literal. This one contains all of our business logic. 
        //The glue between the incomming DNS requests and the outgoing Google Geolocation API calls.
        tempstore = {
            "queries" : {},
            "needsflush" : {},
            //Check a dbm token
            "checkdbm" : function (dbmstring) {
                //The first token in the dns name is the the character 's' followed by the (negative integer) signal strength in dbm.
                var r = dep_parseint_builtin(dbmstring.substr(1, dbmstring.length - 1), 10);
                //The result should be somewhere in the -30dbm .. -100dbm range to be valid. 
                if (r > -30) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid dbm string : " + dbmstring);
                    return false;
                }
                if (r < -100) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid dbm string : " + dbmstring);
                    return false;
                }
                return r;
            },
            //Check a MAC address token.
            "checkmac" : function (macstring) {
                var slen = macstring.length,
                    i,
                    c,
                    r;
                //Must be exactly 12 characters long.
                if (slen !== 12) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid mac string : " + macstring + " (wrong size)");
                    return false;
                }
                for (i = 0; i < slen; i = i + 1) {
                    c = macstring.charAt(i);
                    //each character must be a valid hexadecimal character.
                    if (dep_isnan_builtin(dep_parseint_builtin(c, 16))) {
                        dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid mac string : " + macstring + " (not hex)");
                        return false;
                    }
                }
                //Add the colons in the proper places to get the BSSID mac adress back.
                r = macstring.substr(0, 2) + ":" +
                    macstring.substr(2, 2) + ":" +
                    macstring.substr(4, 2) + ":" +
                    macstring.substr(6, 2) + ":" +
                    macstring.substr(8, 2) + ":" +
                    macstring.substr(10, 2);
                return r;
            },
            //Check a bigish numeric token
            "checkbigint" : function (intstring) {
                var slen = intstring.length,
                    i,
                    c;
                if (slen < 1) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid integer string : " + intstring + " (wrong size)");
                    return false;
                }
                if (slen > 20) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid integer string : " + intstring + " (wrong size)");
                    return false;
                }
                for (i = 0; i < slen; i = i + 1) {
                    c = intstring.charAt(i);
                    if (dep_isnan_builtin(dep_parseint_builtin(c, 10))) {
                        dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invalid integer string : " + intstring + " (not decimal)");
                        return false;
                    }
                }
                return intstring;
            },
            //Parse and add a single DNS name based measurement to the tempstore.
            "add" : function (dnsname) {
                var dnstokens,
                    db, //signal strength of access point
                    mac, //BSSID mac address of access point
                    ticks, //Duno, some ticks variable in DNS query, won't use.
                    sensor, //Unique identifier of sensor.
                    oldestbssid, //oldest mac adress in our dictionary
                    oldestbssidtime, //the unix time that the oldest mac adress was placed in our dictionary.
                    candidatebssid; //candidate for possibly being the oldest mac adress in our dictionary
                //Get and check the first four tokens of the DNS name (ignore the rest).
                dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Incomming DNS request for: " + dnsname);
                dnstokens = dnsname.split(".").slice(0, 4);
                if (dnstokens.length !== 4) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Ignoring DNS request for: " + dnsname + " to few tokens.");
                    return;
                }
                db = tempstore.checkdbm(dnstokens[0]);
                mac = tempstore.checkmac(dnstokens[1].toLowerCase());
                ticks = tempstore.checkbigint(dnstokens[2]);
                sensor = tempstore.checkbigint(dnstokens[3]);
                //Everything irie ??
                if ((db !== false) && (mac !== false) && (ticks !== false) && (sensor !== false)) {
                    //Make sure the specific sensor is defined in our queries store.
                    if (!(tempstore.queries.hasOwnProperty(sensor))) {
                        tempstore.queries[sensor] = {};
                        tempstore.needsflush[sensor] = false;
                    }
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Adding request to tempstore, mac=" + mac);
                    //Add (or overwrite) query for specific BSSID to the tempstore.
                    tempstore.queries[sensor][mac] = {
                        "timestamp" :  dep_math_module.floor(dep_now_function().getTime() / 1000),
                        "dbm" : db,
                        "mac" : mac
                    };
                    tempstore.needsflush[sensor] = true;
                    //We only keep the 10 last seen BSSID's
                    if (dep_dictlen_function(tempstore.queries[sensor]) > 10) {
                        //Find and delete the oldest BSSID.
                        oldestbssidtime = dep_math_module.floor(dep_now_function().getTime() / 1000);
                        oldestbssid = mac;
                        for (candidatebssid in tempstore.queries[sensor]) {
                            if (tempstore.queries[sensor].hasOwnProperty(candidatebssid)) {
                                if (tempstore.queries[sensor][candidatebssid].timestamp < oldestbssidtime) {
                                    oldestbssidtime = tempstore.queries[sensor][candidatebssid].timestamp;
                                    oldestbssid = candidatebssid;
                                }
                            }
                        }
                        //And delete the oldest one.
                        dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Dropping oldest request for mac=" + oldestbssid);
                        delete tempstore.queries[sensor][oldestbssid];
                    }
                } else {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Ignoring DNS request for: " + dnsname);
                }
            },
            "flush" : function () {
                var sensor,
                    bssid,
                    wifiaccesspoints,
                    measurement,
                    age,
                    mac,
                    dbm,
                    now;
                for (sensor in tempstore.queries) {
                    if (tempstore.queries.hasOwnProperty(sensor) && tempstore.needsflush[sensor]) {
                        //This particular sensor has something that needs flushing, we are going to do that now.
                        tempstore.needsflush[sensor] = false;
                        //Construct a helper object for calling the google geolocation api functionality
                        wifiaccesspoints = [];
                        for (bssid in tempstore.queries[sensor]) {
                            if (tempstore.queries[sensor].hasOwnProperty(bssid)) {
                                measurement = tempstore.queries[sensor][bssid];
                                mac = measurement.mac;
                                now = dep_math_module.floor(dep_now_function().getTime() / 1000);
                                age = now - measurement.timestamp;
                                dbm = measurement.dbm;
                                wifiaccesspoints.push({"macAddress" : mac, "age" :  age, "signalStrength" : dbm});
                            }
                        }
                        //Invoke the google geolocation appi functionality
                        dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,"Invoking Google GeoLocation API.");
                        googleapi.lookupmac(sensor, wifiaccesspoints);
                    }
                }
            }
        },
        //DNS server object literal.
        dnsserver = {
            "server" : null,
            "run" : function () {
                dnsserver.server = dep_dns_module.createServer();
                dnsserver.server.on('request', function (request, response) {
                    response.answer.push(dep_dns_module.A({
                        name: request.question[0].name,
                        address: '127.0.0.1',
                        ttl: 600
                    }));
                    response.send();
                    //Try to add to the tempstore, first four name tokens  must meet conventions for this to work.
                    tempstore.add(request.question[0].name);
                });
                dnsserver.server.on('error', function (err) {
                    dep_syslog_module.log(dep_syslog_module.LOG_NOTICE,err.stack);
                });
                dnsserver.server.serve(53);
            }
        };
    dep_syslog_module.init("geodns.js", dep_syslog_module.LOG_PID | dep_syslog_module.LOG_ODELAY, dep_syslog_module.LOG_LOCAL0);
    //Set the Google Geolocation API key using the api.json content.
    googleapi.setkey(dep_settings_json.apikey);
    //Set the maximum per-sensor API request rate to one query per 30 seconds.
    dep_setinterval_builtin(tempstore.flush, 30000);
    //Run the DNS server.
    dnsserver.run();
}(require('https'),        //https module dependency for calling the Google Geolocation API
    // require('./api.json'), //Our config file containing the Google Geoplocation API key.
    require('node-syslog'),
    function (result) {    //FIXME: We should probably push the results to a database or message queue.
        'use strict';
        var fs=require('fs'),
            log=fs.createWriteStream('./geo-events.txt', {'flags': 'a'});
        log.end(result + "\n");
    },
    JSON,                  //JSON module dependency for calling the Google Geolocation API and accessing results.
    Math,                  //Math module dependency. We need 'floor' to determine get at the unix time.
    require('native-dns'), //native-dns module dependency for running as simple DNS server.
    function () {          //Simple function to avoid the evils of using 'new' in our main program.
        'use strict';
        return new Date(); //Constructor functions are globals too, so explicit injection is a good idea to keep the main codebase clean.
    },
    parseInt,              //The parseInt builtin.
    setInterval,           //The setInterval builtin.
    isNaN,                 //The isNaN builtin.
    function (dict) {      //Simple function for returning a 'now' Date.
        'use strict';
        return Object.keys(dict).length;
    }));
