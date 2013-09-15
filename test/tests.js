var assert = require("chai").assert;

var Suds = require("../");

describe("suds", function() {
  describe("callRemote", function() {
    it("should make a call", function(done) {
      var suds = new Suds({
        uri: "http://127.0.0.1:5000/",
        urn: "http://test.uchi/srv",
      });

      suds.callRemote("hello", ["world"], function(err, res) {
        if (err) {
          return done(err);
        }

        console.log(res);

        return done();
      });
    });

    it("should make a call to another service", function(done) {
      this.timeout(30000);

      var suds = new Suds({
        uri: "http://www.webservicex.com/globalweather.asmx",
        urn: "http://www.webserviceX.NET",
      });

      suds.callRemote("GetWeather", ["a", "b"], function(err, res) {
        if (err) {
          return done(err);
        }

        console.log(res);

        return done();
      });
    });
  });
});
