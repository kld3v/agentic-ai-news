#!/bin/bash

# 🎮 Telemetry Test Script
# This script demonstrates all telemetry features

echo "🚀 Testing Agentic AI News Telemetry System"
echo "============================================"

SERVER_URL="http://localhost:3000"

# Function to make requests and show responses
test_endpoint() {
    local method=$1
    local path=$2
    local data=$3
    local description=$4
    
    echo ""
    echo "🔧 Testing: $description"
    echo "   Method: $method $path"
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
            -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$SERVER_URL$path")
    else
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
            -X "$method" \
            "$SERVER_URL$path")
    fi
    
    http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_CODE:/d')
    
    echo "   Status: $http_code"
    echo "   Response: $(echo "$body" | head -c 100)..."
    
    # Small delay to see logs
    sleep 0.5
}

# Test 1: Health Check
test_endpoint "GET" "/health" "" "Health Check Endpoint"

# Test 2: Metrics Endpoint  
test_endpoint "GET" "/metrics" "" "Prometheus Metrics"

# Test 3: Error Statistics
test_endpoint "GET" "/errors" "" "Error Statistics"

# Test 4: Debug Information
test_endpoint "GET" "/debug" "" "Debug Information"

# Test 5: Create News Item (Success)
test_endpoint "POST" "/news" '{
    "summary": "Test news from telemetry script",
    "link": "https://example.com/telemetry-test",
    "author": "Telemetry Tester"
}' "Create News Item (Success)"

# Test 6: Create News Item (Validation Error)
test_endpoint "POST" "/news" '{
    "summary": "",
    "link": "not-a-url"
}' "Create News Item (Validation Error)"

# Test 7: Vote on News Item
test_endpoint "POST" "/vote" '{
    "newsId": 1,
    "voteType": "up",
    "source": "machine"
}' "Vote on News Item"

# Test 8: Security Test (Should be blocked)
test_endpoint "GET" "/?q=<script>alert('xss')</script>" "" "Security Test (XSS Attempt)"

# Test 9: Rate Limiting Test
echo ""
echo "🔥 Testing Rate Limiting (sending 10 rapid requests)..."
for i in {1..10}; do
    curl -s "$SERVER_URL/" > /dev/null &
done
wait

# Test 10: Main Page Load
test_endpoint "GET" "/" "" "Main Page Load"

echo ""
echo "============================================"
echo "✅ Telemetry testing complete!"
echo ""
echo "🔍 Check the following locations for data:"
echo "   📊 Dashboard: http://localhost:3000/monitor.html"
echo "   🏥 Health:    http://localhost:3000/health"
echo "   📈 Metrics:   http://localhost:3000/metrics"
echo "   🔥 Errors:    http://localhost:3000/errors"
echo "   🐛 Debug:     http://localhost:3000/debug"
echo ""
echo "📁 Log files (if in production):"
echo "   📜 Combined:  logs/$(date +%Y-%m-%d)-combined.log"
echo "   ❌ Errors:    logs/$(date +%Y-%m-%d)-error.log"
echo "   ⚡ Performance: logs/$(date +%Y-%m-%d)-performance.log"
echo ""
echo "💡 Monitor the console logs above to see telemetry in action!"
echo "💡 Open the dashboard in your browser for real-time monitoring!"