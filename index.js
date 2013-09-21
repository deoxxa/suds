var request = require("request"),
    xmldom = require("xmldom");

var dom = new xmldom.DOMImplementation(),
    parser = new xmldom.DOMParser(),
    serialiser = new xmldom.XMLSerializer();

var Suds = module.exports = function Suds(options) {
  this._uri = options.uri;
  this._urn = options.urn;
};

Suds.prototype.callRemote = function callRemote(method, parameters, cb) {
  var xml = this.createRequestXml(method, parameters);

  console.log(xml);

  var options = {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
    uri: this._uri,
    body: xml,
  };

  var self = this;

  request(options, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    console.log(data);

    if (res.statusCode !== 200) {
      return cb(Error("invalid status code; expected 200 but got " + res.statusCode));
    }

    console.log(data);

    try {
      var doc = parser.parseFromString(data);  
    } catch (e) {
      return cb(e);
    }

    if (!doc) {
      return cb(Error("couldn't parse response"));
    }

    var result = self._processResponse(doc);

    return cb(null, result);
  });
};

Suds.prototype._processResponse = function _processResponse(doc) {
  var envelope = doc.getElementsByTagNameNS("http://schemas.xmlsoap.org/soap/envelope/", "Envelope");
  if (!envelope.length) { throw new Error("couldn't find envelope element"); }
  envelope = envelope[0];

  var body = envelope.getElementsByTagNameNS("http://schemas.xmlsoap.org/soap/envelope/", "Body");
  if (!body.length) { throw new Error("couldn't find body element"); }
  body = body[0];

  if (!body.hasChildNodes()) {
    throw new Error("body has no child nodes, no response can be found");
  }

  var response = body.childNodes[0];

  var returnValue = response.getElementsByTagName("return");
  if (!returnValue.length) { throw new Error("couldn't find return value"); }
  returnValue = returnValue[0];

  returnValue = this.valueFromXML(returnValue);

  return returnValue;
};

Suds.prototype.valueFromXML = function valueFromXML(xml) {
  var type = xml.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "type");
  if (!type) { throw new Error("couldn't get type"); }

  type = type.split(":");

  var ns = null;
  if (type.length > 1) {
    ns = type.shift();
    type = type.join(":");

    ns = xml.lookupNamespaceURI(ns);

    type = [ns, type].join(":");
  } else {
    type = type[0];
  }

  switch (type) {
    case "http://www.w3.org/2001/XMLSchema:string":
      return this._stringValueFromXML(xml);
    case "http://www.w3.org/2001/XMLSchema:int":
      return this._intValueFromXML(xml);
    case "http://schemas.xmlsoap.org/soap/encoding/:Array":
      return this._arrayValueFromXML(xml);
    case "http://xml.apache.org/xml-soap:Map":
      return this._mapValueFromXML(xml);
    default:
      throw new Error("invalid type: " + type);
  }
};

Suds.prototype._stringValueFromXML = function _stringValueFromXML(xml) {
  return xml.hasChildNodes() ? xml.childNodes[0].data : "";
};

Suds.prototype._intValueFromXML = function _intValueFromXML(xml) {
  return xml.hasChildNodes() ? parseInt(xml.childNodes[0].data, 10) : null;
};

Suds.prototype._arrayValueFromXML = function _arrayValueFromXML(xml) {
  var items = xml.getElementsByTagName("item");

  return [].slice.call(items).map(this.valueFromXML.bind(this));
};

Suds.prototype._mapValueFromXML = function _mapValueFromXML(xml) {
  var items = [].slice.call(xml.childNodes).filter(function(e) {
    return e.tagName === "item";
  });

  var self = this;

  return [].slice.call(items).map(function(e) {
    var key = e.getElementsByTagName("key"),
        val = e.getElementsByTagName("value");

    if (!key.length) { throw new Error("couldn't find key"); }
    if (!val.length) { throw new Error("couldn't find value"); }

    key = key[0];
    val = val[0];

    key = self.valueFromXML(key);
    val = self.valueFromXML(val);

    return [key, val];
  });
};

Suds.prototype._arrayValueToXML = function _arrayValueToXML(arr) {
  var doc = dom.createElementNS("http://schemas.xmlsoap.org/soap/encoding/", "SOAP-ENC:Array");

  return doc;
};

Suds.prototype._objectValueToXML = function _objectValueToXML(name, obj) {
  var doc = dom.createElement(name);

  for (var k in obj) {
    doc.appendChild(this._valueToXML(name, obj[k]));
  }

  return doc;
};

Suds.prototype._stringValueToXML = function _stringValueToXML(name, str) {
  var doc = dom.createElement(name);

  doc.appendChild(dom.createTextNode(str + ""));

  return doc;
};

Suds.prototype._valueToXML = function _valueToXML(name, val) {
  if (Array.isArray(val)) {
    return this._arrayValueToXML(name, val);
  } else if (typeof val === "object") {
    return this._objectValueToXML(name, val);
  } else if (typeof val === "string") {
    return this._stringValueToXML(name, val);
  } else if (typeof val === "number") {
    return this._stringValueToXML(name, val);
  }
};

Suds.prototype.createRequestDocument = function createRequestDocument(method, parameters) {
  var doc = dom.createDocument();

  var env = doc.createElementNS("http://schemas.xmlsoap.org/soap/envelope/", "SOAP-ENV:Envelope");
  doc.appendChild(env);

  env.setAttribute("xmlns:SOAP-ENV", "http://schemas.xmlsoap.org/soap/envelope/");
  env.setAttribute("xmlns:SOAP-ENC", "http://schemas.xmlsoap.org/soap/encoding/");
  env.setAttribute("xmlns:xsd", "http://www.w3.org/2001/XMLSchema");
  env.setAttribute("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance");
  env.setAttribute("xmlns:ns1", this._urn);

  env.setAttributeNS("http://schemas.xmlsoap.org/soap/envelope/", "SOAP-ENV:encodingStyle", "http://schemas.xmlsoap.org/soap/encoding/");

  var body = doc.createElementNS("http://schemas.xmlsoap.org/soap/envelope/", "SOAP-ENV:Body")
  env.appendChild(body);

  var req = doc.createElementNS(this._urn, ["ns1", method].join(":"));
  body.appendChild(req);

  for (var i=0;i<parameters.length;++i) {
    var parameter = doc.createElement(["param", i].join(""));
    parameter.setAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "xsi:type", "xsd:string");
    req.appendChild(parameter);
    parameter.appendChild(doc.createTextNode(parameters[i]));
  }

  return doc;
};

Suds.prototype.createRequestXml = function createRequestXml(method, parameters) {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    serialiser.serializeToString(this.createRequestDocument(method, parameters)),
  ].join("\n");
};
