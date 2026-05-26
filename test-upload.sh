#!/bin/bash

# Test Document Upload Feature
# This script runs the TeleConnect test with document upload

echo "🚀 Starting TeleConnect Order Journey Test with Document Upload"
echo "════════════════════════════════════════════════════════════════"

# Check if resources exist
echo ""
echo "📂 Checking test documents..."
if [ ! -f "resources/Aadhar.png" ]; then
  echo "❌ ERROR: Aadhar.png not found in resources/"
  exit 1
fi

echo "✅ Found resources:"
ls -lh resources/*.png

# Run the test
echo ""
echo "🧪 Running test suite..."
echo ""

HEADLESS=false npm test -- --tags @teleconnect

exit_code=$?

echo ""
echo "════════════════════════════════════════════════════════════════"
if [ $exit_code -eq 0 ]; then
  echo "✅ Test completed successfully!"
else
  echo "❌ Test failed with exit code: $exit_code"
fi

exit $exit_code
