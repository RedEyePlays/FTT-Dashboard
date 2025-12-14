#!/bin/bash
# Firebase Hosting Build Script

echo "Installing dependencies..."
npm install

echo "Building the application..."
npm run build

echo "Copying test.html to dist..."
cp test.html dist/

echo "Build complete! Ready to deploy to Firebase Hosting."
echo "Output directory: dist/"
