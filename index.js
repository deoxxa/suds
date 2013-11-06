var request = require("request"),
    url = require("url"),
    WSDL = require("wsdl"),
    xmldom = require("xmldom");

var dom = new xmldom.DOMImplementation(),
    document = dom.createDocument(),
    parser = new xmldom.DOMParser(),
    serialiser = new xmldom.XMLSerializer();

var makeElement = function makeElement(src) {
  if (typeof src === "function") {
    src = src();
  }

  if (typeof src === "string") {
    return document.createTextNode(src);
  }

  if (!Array.isArray(src)) {
    throw new Error("invalid input to makeElement");
  }

  var node = document.createElementNS(src[0][0], "tempns:" + src[0][1]);
  node.setAttribute("xmlns:tempns", src[0][0]);

  if (src[1]) {
    for (var k in src[1]) {
      node.setAttribute(k, src[1][k]);
    }
  }

  src[2].map(makeElement).forEach(function(e) {
    node.appendChild(e);
  });

  return node;
};

var Suds = module.exports = function Suds(options) {
  options = options || {};

  this._headers = options.headers || [];

  if (options.request) {
    this._request = options.request;
  }
};

Suds.prototype._request = request;

Suds.prototype.callRemote = function callRemote(uri, action, method, parameters, cb) {
  var xml = this.createRequestXml(method, parameters);

  var options = {
    method: "POST",
    uri: uri,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "soapaction": action,
    },
    body: xml,
  };

  var self = this;

  this._request.call(this._request, options, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    if (res.statusCode !== 200) {
      return cb(Error("invalid status code; expected 200 but got " + res.statusCode));
    }

    try {
      var doc = parser.parseFromString(data);  
    } catch (e) {
      return cb(e);
    }

    if (!doc) {
      return cb(Error("couldn't parse response"));
    }

    try {
      var result = self._processResponse(doc.documentElement);
    } catch (e) {
      return cb(e);
    }

    return cb(null, result);
  });
};

Suds.prototype._processResponse = function _processResponse(doc) {
  if (doc.namespaceURI !== "http://schemas.xmlsoap.org/soap/envelope/" || doc.localName !== "Envelope") {
    throw new Error("invalid root tag type in response");
  }

  var fault = [].slice.call(doc.childNodes).filter(function(e) {
    return e.namespaceURI === "http://schemas.xmlsoap.org/soap/envelope/" && e.localName === "Fault";
  }).shift();

  if (fault) {
    throw fault;
  }

  var body = [].slice.call(doc.childNodes).filter(function(e) {
    return e.namespaceURI === "http://schemas.xmlsoap.org/soap/envelope/" && e.localName === "Body";
  }).shift();

  if (!body) {
    throw new Error("couldn't find response body");
  }

  var content = [].slice.call(body.childNodes).filter(function(e) {
    return e.localName;
  }).shift();

  return content;
};

Suds.prototype.createRequestDocument = function createRequestDocument(method, parameters) {
  var doc = dom.createDocument();

  var env = doc.createElementNS("http://schemas.xmlsoap.org/soap/envelope/", "SOAP-ENV:Envelope");
  doc.appendChild(env);

  env.setAttribute("xmlns:SOAP-ENV", "http://schemas.xmlsoap.org/soap/envelope/");
  env.setAttribute("xmlns:SOAP-ENC", "http://schemas.xmlsoap.org/soap/encoding/");
  env.setAttribute("xmlns:xsd", "http://www.w3.org/2001/XMLSchema");
  env.setAttribute("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance");
  env.setAttribute("xmlns:ns1", method[0]);

  env.setAttributeNS("http://schemas.xmlsoap.org/soap/envelope/", "SOAP-ENV:encodingStyle", "http://schemas.xmlsoap.org/soap/encoding/");

  this._headers.forEach(function(header) {
    env.appendChild(makeElement([["http://schemas.xmlsoap.org/soap/envelope/", "Header"], null, [
      header,
    ]]));
  });

  var body = doc.createElementNS("http://schemas.xmlsoap.org/soap/envelope/", "SOAP-ENV:Body")
  env.appendChild(body);

  var req = doc.createElementNS(this._urn, ["ns1", method[1]].join(":"));
  body.appendChild(req);

  for (var i=0;i<parameters.length;++i) {
    var node = parameters[i];

    if (!node.localName) {
      node = makeElement(node);
    }

    req.appendChild(node);
  }

  return doc;
};

Suds.prototype.createRequestXml = function createRequestXml(method, parameters) {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    serialiser.serializeToString(this.createRequestDocument(method, parameters)),
  ].join("\n");
};

var _wsdlOptions = {
  portHandlers: [function(port, element) {
    var soapAddresses = element.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/soap/", "address");

    if (soapAddresses.length === 1) {
      port.soap = {
        address: {
          location: soapAddresses[0].getAttribute("location"),
        },
      };
    }
  }],
  bindingHandlers: [function(binding, element) {
    var soapBindings = element.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/soap/", "binding");

    if (soapBindings.length === 1) {
      binding.soap = {
        binding: {
          style: soapBindings[0].getAttribute("style"),
          transport: soapBindings[0].getAttribute("transport"),
        },
      };
    }
  }],
  operationHandlers: [function(operation, element) {
    var soapOperations = element.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/soap/", "operation");

    if (soapOperations.length === 1) {
      operation.soapOperation = {
        soapAction: soapOperations[0].getAttribute("soapAction"),
      };
    }

    var inputElement = element.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/", "input");
    if (inputElement.length) {
      inputElement = inputElement[0];

      var inputBodyElement = inputElement.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/soap/", "body");
      if (inputBodyElement.length) {
        inputBodyElement = inputBodyElement[0];

        operation.input.soap = {};

        if (inputBodyElement.hasAttribute("parts")) {
          operation.input.soap.parts = inputBodyElement.getAttribute("parts");
        }

        if (inputBodyElement.hasAttribute("use")) {
          operation.input.soap.use = inputBodyElement.getAttribute("use");
        }

        if (inputBodyElement.hasAttribute("namespace")) {
          operation.input.soap.namespace = inputBodyElement.getAttribute("namespace");
        }

        if (inputBodyElement.hasAttribute("encodingStyle")) {
          operation.input.soap.encodingStyle = inputBodyElement.getAttribute("encodingStyle");
        }
      }
    }

    var outputElement = element.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/", "output");
    if (outputElement.length) {
      outputElement = outputElement[0];

      var outputBodyElement = outputElement.getElementsByTagNameNS("http://schemas.xmlsoap.org/wsdl/soap/", "body");
      if (outputBodyElement.length) {
        outputBodyElement = outputBodyElement[0];

        operation.output.soap = {};

        if (outputBodyElement.hasAttribute("parts")) {
          operation.output.soap.parts = outputBodyElement.getAttribute("parts");
        }

        if (outputBodyElement.hasAttribute("use")) {
          operation.output.soap.use = outputBodyElement.getAttribute("use");
        }

        if (outputBodyElement.hasAttribute("namespace")) {
          operation.output.soap.namespace = outputBodyElement.getAttribute("namespace");
        }

        if (outputBodyElement.hasAttribute("encodingStyle")) {
          operation.output.soap.encodingStyle = outputBodyElement.getAttribute("encodingStyle");
        }
      }
    }
  }],
};

Suds.prototype.loadWsdl = function load(wsdlUri, cb) {
  var wsdlOptions = Object.create(_wsdlOptions);

  wsdlOptions.request = this._request;

  var self = this;
  WSDL.load(wsdlOptions, wsdlUri, function(err, wsdl) {
    if (err) {
      return cb(err);
    }

    wsdl.services.forEach(function(service) {
      service.ports.forEach(function(port) {
        if (!port || !port.soap || !port.soap.address || !port.soap.address.location) {
          return;
        }

        var binding = wsdl.bindings.filter(function(binding) {
          return binding.name[0] === port.binding[0] && binding.name[1] === port.binding[1];
        }).shift();

        if (!binding) {
          return;
        }

        binding.operations.forEach(function(operation) {
          if (!operation || !operation.input || !operation.input.soap || !operation.input.soap.namespace) {
            return;
          }

          if (!operation || !operation.soapOperation || !operation.soapOperation.soapAction) {
            return;
          }

          self[operation.name] = self.callRemote.bind(self, port.soap.address.location, operation.soapOperation.soapAction, [operation.input.soap.namespace, operation.input.name]);
        });
      });
    });

    return cb();
  });
};
