"""
Test script for web crawler functionality.
"""
import sys
sys.path.insert(0, '/home/frappe/Applications/ai-chatassist/backend')

from app.services.web_crawler import WebCrawler


def test_single_page_crawl():
    """Test crawling a single page."""
    print("=" * 60)
    print("Test 1: Single Page Crawl")
    print("=" * 60)
    
    crawler = WebCrawler()
    result = crawler.crawl_single_page("https://example.com")
    
    if result:
        print(f"✓ Successfully crawled: {result['title']}")
        print(f"  URL: {result['url']}")
        print(f"  Text length: {len(result['text'])} characters")
        assert len(result['text']) > 0, "Text should not be empty"
        assert result['title'], "Title should exist"
        print("✓ All assertions passed\n")
        return True
    else:
        print("✗ Failed to crawl\n")
        return False


def test_crawl_and_combine_single():
    """Test crawl_and_combine with single page."""
    print("=" * 60)
    print("Test 2: Crawl and Combine (Single Page)")
    print("=" * 60)
    
    crawler = WebCrawler()
    result = crawler.crawl_and_combine("https://example.com", crawl_multiple=False)
    
    print(f"✓ Title: {result['title']}")
    print(f"✓ Source URI: {result['source_uri']}")
    print(f"✓ Pages crawled: {result['pages_crawled']}")
    print(f"✓ Text length: {len(result['text'])}")
    
    assert result['pages_crawled'] == 1, "Should crawl exactly 1 page"
    assert len(result['text']) > 0, "Text should not be empty"
    assert result['source_uri'] == "https://example.com", "Source URI should match"
    
    print("✓ All assertions passed\n")
    return True


def test_crawl_and_combine_multiple():
    """Test crawl_and_combine with multiple pages (if available)."""
    print("=" * 60)
    print("Test 3: Crawl and Combine (Multiple Pages)")
    print("=" * 60)
    
    crawler = WebCrawler(max_pages=3, max_depth=1)
    result = crawler.crawl_and_combine("https://example.com", crawl_multiple=True)
    
    print(f"✓ Title: {result['title']}")
    print(f"✓ Pages crawled: {result['pages_crawled']}")
    print(f"✓ Text length: {len(result['text'])}")
    
    assert result['pages_crawled'] >= 1, "Should crawl at least 1 page"
    assert len(result['text']) > 0, "Text should not be empty"
    
    print("✓ All assertions passed\n")
    return True


def test_error_handling():
    """Test error handling for invalid URLs."""
    print("=" * 60)
    print("Test 4: Error Handling")
    print("=" * 60)
    
    crawler = WebCrawler()
    result = crawler.crawl_single_page("https://this-domain-definitely-does-not-exist-12345.com")
    
    if result is None:
        print("✓ Correctly returned None for invalid URL")
        print("✓ Error handling works as expected\n")
        return True
    else:
        print("✗ Should have returned None for invalid URL\n")
        return False


if __name__ == "__main__":
    print("\n🚀 Starting Web Crawler Tests\n")
    
    results = []
    results.append(("Single Page Crawl", test_single_page_crawl()))
    results.append(("Crawl and Combine (Single)", test_crawl_and_combine_single()))
    results.append(("Crawl and Combine (Multiple)", test_crawl_and_combine_multiple()))
    results.append(("Error Handling", test_error_handling()))
    
    print("=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    for name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{status}: {name}")
    
    total = len(results)
    passed = sum(1 for _, p in results if p)
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✓ All tests passed successfully!")
        sys.exit(0)
    else:
        print(f"\n✗ {total - passed} test(s) failed")
        sys.exit(1)
