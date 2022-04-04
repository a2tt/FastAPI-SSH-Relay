/**
 * https://github.com/huashengdun/webssh/
 * The MIT License (MIT)
 *
 * Copyright (c) 2017 Shengdun Hua
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * */

/*jslint browser:true */

let default_title = 'WebSSH';
const title_element = document.querySelector('title');

var button = $('.btn-primary'),
  form_container = $('.form-container'),
  term_type = $('#term'),
  style = {},
  form_id = '#connect',
  debug = document.querySelector(form_id).noValidate,
  key_max_size = 16384,
  fields = ['hostname', 'port', 'username'],
  form_keys = fields.concat(['password', 'totp']),
  validated_form_data,
  hostname_tester = /((^\s*((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))\s*$)|(^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$))|(^\s*((?=.{1,255}$)(?=.*[A-Za-z].*)[0-9A-Za-z](?:(?:[0-9A-Za-z]|\b-){0,61}[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:(?:[0-9A-Za-z]|\b-){0,61}[0-9A-Za-z])?)*)\s*$)/;

class Term {
  constructor() {
    this.sock = null;
    this.terminal = document.getElementById('terminal');

    this.termOptions = {
      cursorBlink: true,
    };
    this.xterm = new Terminal(this.termOptions)
    this.xterm.fitAddon = new FitAddon.FitAddon();
    this.xterm.loadAddon(this.xterm.fitAddon);
    this.xtermInit = false;

    this.handleResizeWindow();
  }

  setSock(sock) {
    this.sock = sock;
  }

  initTerm() {
    if (this.xtermInit) return;

    this.xterm.open(this.terminal);
    // this.xterm.fitAddon.fit();
    this.xterm.focus();

    // Add event listeners
    this.xterm.on_resize = function (cols, rows) {
      if (cols !== this.cols || rows !== this.rows) {
        console.log('Resizing terminal to geometry: ' + JSON.stringify({'cols': cols, 'rows': rows}));
        this.resize(cols, rows);
        this.sock.send(JSON.stringify({'resize': [cols, rows]}));
      }
    };

    this.xterm.onData((data) => {
      console.log('term.onData', data);
      this.sock.send(JSON.stringify({'data': data}));
    });
  }

  write(text) {
    this.xterm.write(text);
    if (!this.xterm.resized) {
      this.resize_terminal(this.xterm);
      this.xterm.resized = true;
    }
  }

  static get_cell_size(term) {
    style.width = term._core._renderService._renderer.dimensions.actualCellWidth;
    style.height = term._core._renderService._renderer.dimensions.actualCellHeight;
  }

  static current_geometry(term) {
    if (!style.width || !style.height) {
      try {
        Term.get_cell_size(term);
      } catch (TypeError) {
        parse_xterm_style();
      }
    }

    var cols = parseInt(window.innerWidth / style.width, 10) - 1;
    var rows = parseInt(window.innerHeight / style.height, 10);
    return {'cols': cols, 'rows': rows};
  }

  resize_terminal(term) {
    let geometry = Term.current_geometry(term);
    // this.xterm.on_resize(geometry.cols, geometry.rows); // FIXME
  }

  handleResizeWindow() {
    $(window).resize(() => {
      if (this.xterm) {
        this.resize_terminal(this.xterm);
      }
    });
  }
}

class WSClient {
  constructor(url) {
    this.url = url || window.location.href;
    this.sock = null;
    this.encoding = 'utf-8';

    this.term = new Term();
  }

  connect({hostname, port, username, password},) {
    // FIXME hide data from query string
    let url = new URL(this.url)
    url.search = new URLSearchParams({
      hostname, port, username, password
    })

    this.sock = new WebSocket(url);
    this.term.setSock(this.sock)

    // FIXME when reconnected, following event handlers may be called more than once.
    this.sock.onopen = this.onOpen.bind(this);
    this.sock.onclose = this.onClose.bind(this);
    this.sock.onerror = this.onError.bind(this);
    this.sock.onmessage = this.onMessage.bind(this);
  }

  onOpen() {
    this.term.initTerm();
    title_element.text = default_title;
  }

  onMessage(msg) {
    console.log(msg.data)
    this.read_file_as_text(msg.data);
  }

  onError(e) {
    console.error(e);
  }

  onClose(e) {
    this.term.xterm.dispose();
    setTimeout(() => {
      this.term.xterm = undefined;
    }, 1000)
    this.sock = undefined;
    console.error(e.reason);
    default_title = 'WebSSH';
    title_element.text = default_title;
  }


  read_file_as_text(file) {
    let reader = new window.FileReader();

    reader.onload = () => {
      this.term.write(reader.result)
    };

    reader.onerror = (e) => {
      console.error(e);
    };

    if (!window.TextDecoder) {
      reader.readAsText(file, this.encoding || 'utf-8');
    } else {
      reader.readAsBinaryString(file);
    }
  }
}


function store_items(names, data) {
  let i, name, value;

  for (i = 0; i < names.length; i++) {
    name = names[i];
    value = data.get(name);
    if (value) {
      window.localStorage.setItem(name, value);
    }
  }
}

function restore_items(names) {
  var i, name, value;

  for (i = 0; i < names.length; i++) {
    name = names[i];
    value = window.localStorage.getItem(name);
    if (value) {
      $('#' + name).val(value);
    }
  }
}

function parse_xterm_style() {
  var text = $('.xterm-helpers style').text();
  var arr = text.split('xterm-normal-char{width:');
  style.width = parseFloat(arr[1]);
  arr = text.split('div{height:');
  style.height = parseFloat(arr[1]);
}

function wrap_object(opts) {
  var obj = {};

  obj.get = function (attr) {
    return opts[attr] || '';
  };

  obj.set = function (attr, val) {
    opts[attr] = val;
  };

  return obj;
}

function clean_data(data) {
  let i, attr, val;
  let attrs = form_keys.concat(['privatekey', 'passphrase']);

  for (i = 0; i < attrs.length; i++) {
    attr = attrs[i];
    val = data.get(attr);
    if (typeof val === 'string') {
      data.set(attr, val.trim());
    }
  }
}

function validate_form_data(data) {
  clean_data(data);

  var hostname = data.get('hostname'),
    port = data.get('port'),
    username = data.get('username'),
    pk = data.get('privatekey'),
    result = {
      valid: false,
      data: data,
      title: ''
    },
    errors = [], size;

  if (!hostname) {
    errors.push('Value of hostname is required.');
  } else {
    if (!hostname_tester.test(hostname)) {
      errors.push('Invalid hostname: ' + hostname);
    }
  }

  if (!port) {
    port = 22;
  } else {
    if (!(port > 0 && port <= 65535)) {
      errors.push('Invalid port: ' + port);
    }
  }

  if (!username) {
    errors.push('Value of username is required.');
  }

  if (pk) {
    size = pk.size || pk.length;
    if (size > key_max_size) {
      errors.push('Invalid private key: ' + pk.name || '');
    }
  }

  if (!errors.length || debug) {
    result.valid = true;
    result.title = username + '@' + hostname + ':' + port;
  }
  result.errors = errors;

  return result;
}

function connect_with_options(data) {
  // use data from the arguments
  let form = document.querySelector(form_id),
    _xsrf = form.querySelector('input[name="_xsrf"]');

  let result = validate_form_data(wrap_object(data));
  if (!result.valid) {
    console.error(result.errors.join('\n'));
    return result;
  }

  data.term = term_type.val();
  data._xsrf = _xsrf.value;

  button.prop('disabled', true);

  // Connect websocket
  let ws_url = window.location.href.split(/\?|#/, 1)[0].replace('http', 'ws'),
    join = (ws_url[ws_url.length - 1] === '/' ? '' : '/'),
    url = ws_url + join + 'ws';
  const wsClient = new WSClient(url);
  wsClient.connect(data);

  button.prop('disabled', false);
}


function connect(hostname, port, username, password, privatekey, passphrase, totp) {
  let result, opts;

  // TODO prevent users from connecting multiple times

  opts = {
    hostname: hostname,
    port: port,
    username: username,
    password: password,
    privatekey: privatekey,
    passphrase: passphrase,
    totp: totp
  };

  result = connect_with_options(opts);

  if (result) {
    default_title = result.title;
    validated_form_data = result.data;
    store_items(fields, result.data);
  }
}

$(form_id).submit(function (event) {
  event.preventDefault();
  const form = new FormData(event.target);
  connect(
    form.get('hostname'), form.get('port'), form.get('username'),
    form.get('password'), form.get('privatekey'), form.get('passphrase'),
    form.get('totp'));
});


(function () {
  restore_items(fields);
  form_container.show();

  // For FormData without getter and setter
  let proto = FormData.prototype,
    data = {};

  if (!proto.get) {
    proto.get = function (name) {
      if (data[name] === undefined) {
        let input = document.querySelector('input[name="' + name + '"]'),
          value;
        if (input) {
          if (input.type === 'file') {
            value = input.files[0];
          } else {
            value = input.value;
          }
          data[name] = value;
        }
      }
      return data[name];
    };
  }

  if (!proto.set) {
    proto.set = function (name, value) {
      data[name] = value;
    };
  }
}());
