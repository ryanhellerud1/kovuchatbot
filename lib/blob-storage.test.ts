/**
 * Test file for blob storage utilities
 * This file can be used to verify blob storage functionality
 */

import { 
  shouldUseBlobStorage, 
  validateFileSize, 
  formatFileSize, 
  generateUniqueFilename,
  getBlobFolder,
} from './blob-storage';

// Test file size validation
console.log('Testing file size validation...');
console.log('1MB file valid:', validateFileSize(1024 * 1024)); // Should be true
console.log('60MB file valid:', validateFileSize(60 * 1024 * 1024)); // Should be false
console.log('50MB file valid:', validateFileSize(50 * 1024 * 1024)); // Should be true

// Test blob storage threshold
console.log('\nTesting blob storage threshold...');
console.log('1MB needs blob:', shouldUseBlobStorage(1024 * 1024)); // Should be false
console.log('5MB needs blob:', shouldUseBlobStorage(5 * 1024 * 1024)); // Should be true
console.log('4.5MB needs blob:', shouldUseBlobStorage(4.5 * 1024 * 1024)); // Should be false
console.log('4.6MB needs blob:', shouldUseBlobStorage(4.6 * 1024 * 1024)); // Should be true

// Test file size formatting
console.log('\nTesting file size formatting...');
console.log('1024 bytes:', formatFileSize(1024)); // Should be "1 KB"
console.log('1048576 bytes:', formatFileSize(1048576)); // Should be "1 MB"
console.log('5242880 bytes:', formatFileSize(5242880)); // Should be "5 MB"

// Test unique filename generation
console.log('\nTesting unique filename generation...');
const filename1 = generateUniqueFilename('test.pdf');
const filename2 = generateUniqueFilename('test.pdf');
console.log('Filename 1:', filename1);
console.log('Filename 2:', filename2);
console.log('Filenames are different:', filename1 !== filename2); // Should be true

// Test blob folder generation
console.log('\nTesting blob folder generation...');
console.log('Attachment folder (no user):', getBlobFolder('attachment')); // Should be "attachments"
console.log('Attachment folder (with user):', getBlobFolder('attachment', 'user123')); // Should be "attachments/user123"
console.log('Knowledge folder:', getBlobFolder('knowledge', 'user123')); // Should be "knowledge/user123"
console.log('Artifact folder:', getBlobFolder('artifact', 'user456')); // Should be "artifacts/user456"

console.log('\nAll tests completed!');