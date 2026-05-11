import { handleHostingerMcpRequest } from '../src/mcp/hostinger.js';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

class MockRequest extends EventEmitter {
  method = 'POST';
  url = '/mcp/hostinger';
  headers = { 'content-type': 'application/json' };
  
  constructor(public body: any) {
    super();
  }

  [Symbol.asyncIterator]() {
    const data = JSON.stringify(this.body);
    let sent = false;
    return {
      async next() {
        if (sent) return { done: true, value: undefined };
        sent = true;
        return { done: false, value: Buffer.from(data) };
      }
    };
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: any = {};
  data = '';

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  
  write(chunk: any) {
    this.data += chunk.toString();
    return true;
  }
  
  end(chunk?: any) {
    if (chunk) this.data += chunk.toString();
    this.emit('finish');
  }
}

async function test() {
  console.log("Testing Hostinger MCP Tool Listing...");
  
  const req = new MockRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'list_tools',
    params: {}
  });
  
  const res = new MockResponse();
  
  handleHostingerMcpRequest(req as any, res as any, req.body);
  
  res.on('finish', () => {
    console.log("Response Received:");
    console.log(res.data);
  });
}

test().catch(console.error);
