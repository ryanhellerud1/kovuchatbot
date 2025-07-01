'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';

export function DebugUpload() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `${new Date().toISOString()}: ${message}`]);
  };

  const testUpload = async () => {
    setIsLoading(true);
    setLogs([]);
    
    try {
      addLog('Starting upload test...');
      
      // Create a simple test file
      const testContent = 'This is a test document for debugging upload issues.\n\nIt contains multiple lines to test the document processing pipeline.';
      const testFile = new File([testContent], 'debug-test.txt', { type: 'text/plain' });
      
      addLog(`Test file created: ${testFile.name} (${testFile.size} bytes, ${testFile.type})`);
      
      // Create form data
      const formData = new FormData();
      formData.append('file', testFile);
      formData.append('saveToBlob', 'false');
      
      addLog('Form data created, sending request...');
      
      const response = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      });
      
      addLog(`Response received: ${response.status} ${response.statusText}`);
      
      const contentType = response.headers.get('content-type');
      addLog(`Content-Type: ${contentType}`);
      
      // Log all response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      addLog(`Response headers: ${JSON.stringify(headers, null, 2)}`);
      
      if (contentType && contentType.includes('application/json')) {
        try {
          const data = await response.json();
          addLog(`JSON response: ${JSON.stringify(data, null, 2)}`);
          
          if (data.success) {
            addLog('✅ Upload successful!');
          } else {
            addLog(`❌ Upload failed: ${data.error}`);
            if (data.details) {
              addLog(`Details: ${data.details}`);
            }
          }
        } catch (jsonError) {
          addLog(`❌ Failed to parse JSON response: ${jsonError}`);
        }
      } else {
        const text = await response.text();
        addLog(`❌ Non-JSON response received: ${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`);
      }
      
    } catch (error) {
      addLog(`❌ Upload test failed with error: ${error}`);
      if (error instanceof Error) {
        addLog(`Error message: ${error.message}`);
        addLog(`Error stack: ${error.stack}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const testBlobUpload = async () => {
    setIsLoading(true);
    setLogs([]);
    
    try {
      addLog('Starting blob upload test...');
      
      // Create a larger test file to trigger blob upload
      const testContent = 'This is a large test document for blob upload testing.\n'.repeat(1000);
      const testFile = new File([testContent], 'blob-test.txt', { type: 'text/plain' });
      
      addLog(`Large test file created: ${testFile.name} (${(testFile.size / 1024).toFixed(1)} KB, ${testFile.type})`);
      
      // Test blob upload
      addLog('Testing blob upload...');
      const formData = new FormData();
      formData.append('file', testFile);
      formData.append('filename', testFile.name);
      formData.append('contentType', testFile.type);
      
      const uploadResponse = await fetch('/api/blob/upload', {
        method: 'POST',
        body: formData,
      });
      
      addLog(`Upload response: ${uploadResponse.status} ${uploadResponse.statusText}`);
      
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        addLog(`Upload data: ${JSON.stringify(uploadData, null, 2)}`);
        addLog('✅ Blob upload successful!');
        
        // Test document processing from blob
        addLog('Testing document processing from blob...');
        const processResponse = await fetch('/api/knowledge/process-blob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blobUrl: uploadData.url,
            filename: uploadData.originalFilename,
          }),
        });
        
        addLog(`Process response: ${processResponse.status} ${processResponse.statusText}`);
        
        if (processResponse.ok) {
          const processData = await processResponse.json();
          addLog(`Process data: ${JSON.stringify(processData, null, 2)}`);
          addLog('✅ Document processing successful!');
        } else {
          const errorText = await processResponse.text();
          addLog(`❌ Document processing failed: ${errorText}`);
        }
      } else {
        const errorText = await uploadResponse.text();
        addLog(`❌ Blob upload failed: ${errorText}`);
      }
      
    } catch (error) {
      addLog(`❌ Blob upload test failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const testFilesEndpoint = async () => {
    setIsLoading(true);
    setLogs([]);
    
    try {
      addLog('Testing files upload endpoint...');
      
      // Create a simple test file
      const testContent = 'This is a test document for the files endpoint.';
      const testFile = new File([testContent], 'files-test.txt', { type: 'text/plain' });
      
      addLog(`Test file created: ${testFile.name} (${testFile.size} bytes, ${testFile.type})`);
      
      // Create form data
      const formData = new FormData();
      formData.append('file', testFile);
      formData.append('type', 'knowledge');
      
      addLog('Form data created, sending request to /api/files/upload...');
      
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });
      
      addLog(`Response received: ${response.status} ${response.statusText}`);
      
      const contentType = response.headers.get('content-type');
      addLog(`Content-Type: ${contentType}`);
      
      if (contentType && contentType.includes('application/json')) {
        try {
          const data = await response.json();
          addLog(`JSON response: ${JSON.stringify(data, null, 2)}`);
        } catch (jsonError) {
          addLog(`❌ Failed to parse JSON response: ${jsonError}`);
        }
      } else {
        const text = await response.text();
        addLog(`❌ Non-JSON response received: ${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`);
      }
      
    } catch (error) {
      addLog(`❌ Files endpoint test failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Upload Debug Tool</h2>
      
      <div className="flex gap-4 mb-4 flex-wrap">
        <Button 
          onClick={testUpload} 
          disabled={isLoading}
          variant="default"
        >
          {isLoading ? 'Testing...' : 'Test Knowledge Upload'}
        </Button>
        
        <Button 
          onClick={testBlobUpload} 
          disabled={isLoading}
          variant="default"
        >
          {isLoading ? 'Testing...' : 'Test Blob Upload'}
        </Button>
        
        <Button 
          onClick={testFilesEndpoint} 
          disabled={isLoading}
          variant="outline"
        >
          {isLoading ? 'Testing...' : 'Test Files Upload'}
        </Button>
        
        <Button 
          onClick={() => setLogs([])} 
          variant="secondary"
        >
          Clear Logs
        </Button>
      </div>
      
      <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg max-h-96 overflow-y-auto">
        <h3 className="font-medium mb-2">Debug Logs:</h3>
        {logs.length === 0 ? (
          <p className="text-gray-500">No logs yet. Click a test button to start.</p>
        ) : (
          <pre className="text-sm whitespace-pre-wrap">
            {logs.join('\n')}
          </pre>
        )}
      </div>
    </Card>
  );
}