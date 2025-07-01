/**
 * Debug script to test document upload functionality
 * Run this in the browser console to test upload endpoints
 */

async function testUpload() {
  console.log('Testing document upload...');
  
  // Create a simple test file
  const testContent = 'This is a test document for debugging upload issues.';
  const testFile = new File([testContent], 'test-document.txt', { type: 'text/plain' });
  
  console.log('Test file created:', {
    name: testFile.name,
    size: testFile.size,
    type: testFile.type
  });
  
  // Create form data
  const formData = new FormData();
  formData.append('file', testFile);
  formData.append('saveToBlob', 'false'); // Use database storage for small test file
  
  try {
    console.log('Sending request to /api/knowledge/upload...');
    
    const response = await fetch('/api/knowledge/upload', {
      method: 'POST',
      body: formData,
    });
    
    console.log('Response received:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });
    
    const contentType = response.headers.get('content-type');
    console.log('Content-Type:', contentType);
    
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log('JSON response:', data);
    } else {
      const text = await response.text();
      console.log('Non-JSON response:', text);
    }
    
  } catch (error) {
    console.error('Upload test failed:', error);
  }
}

// Run the test
testUpload();