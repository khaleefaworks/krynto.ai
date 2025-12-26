# Web Crawler Service

The web crawler service allows you to automatically extract knowledge from website URLs.

## Features

- **Single Page Crawling**: Extract content from a specific URL
- **Multi-Page Crawling**: Crawl multiple pages within the same domain
- **Smart Content Extraction**: Removes navigation, scripts, styles, and other non-content elements
- **Configurable Depth**: Control how deep the crawler should go
- **Automatic Integration**: Works seamlessly with existing document processing and chunking

## API Endpoint

### POST `/knowledge/documents/crawl`

Crawl a website URL and create a document from the extracted content.

**Request Body:**
```json
{
  "website_id": 1,
  "knowledge_source_id": 1,
  "url": "https://example.com/docs",
  "crawl_multiple": false,  // Optional: crawl multiple pages (default: false)
  "max_pages": 10           // Optional: max pages to crawl (default: 10)
}
```

**Response:**
```json
{
  "document_id": 6,
  "title": "Example Documentation",
  "source_uri": "https://example.com/docs",
  "pages_crawled": 1,
  "chunks_created": 5,
  "text_length": 2450
}
```

## Usage Examples

### Single Page Crawl

```python
import requests

response = requests.post(
    'http://localhost:8000/knowledge/documents/crawl',
    headers={'Authorization': f'Bearer {token}'},
    json={
        'website_id': 1,
        'knowledge_source_id': 1,
        'url': 'https://example.com/help',
        'crawl_multiple': False
    }
)

data = response.json()
print(f"Created document {data['document_id']} with {data['chunks_created']} chunks")
```

### Multi-Page Crawl

```python
response = requests.post(
    'http://localhost:8000/knowledge/documents/crawl',
    headers={'Authorization': f'Bearer {token}'},
    json={
        'website_id': 1,
        'knowledge_source_id': 1,
        'url': 'https://example.com/docs',
        'crawl_multiple': True,
        'max_pages': 20  // Crawl up to 20 pages
    }
)
```

## How It Works

1. **Fetches the URL**: Uses requests library to retrieve the page content
2. **Parses HTML**: Uses BeautifulSoup to extract structured content
3. **Cleans Content**: Removes scripts, styles, navigation, headers, footers
4. **Extracts Text**: Gets clean text content with proper formatting
5. **Creates Document**: Stores in database with source URL
6. **Chunks Text**: Uses existing chunking service for optimal embedding size
7. **Ready for Indexing**: Document can be indexed to generate embeddings

## Crawler Configuration

The `WebCrawler` class in `app/services/web_crawler.py` supports:

- `max_pages`: Maximum number of pages to crawl (default: 10)
- `max_depth`: Maximum depth from starting URL (default: 2)
- Domain restriction: Only crawls URLs within the same domain
- Timeout: 10 seconds per page request
- User-Agent: Identifies as "AI-ChatAssist-Crawler/1.0"

## Error Handling

The crawler gracefully handles:
- Invalid URLs (returns 400 Bad Request)
- Network timeouts
- SSL/TLS errors
- HTML parsing failures
- Empty content (returns error if no content extracted)

## Best Practices

1. **Start Small**: Begin with single page crawls to verify content quality
2. **Limit Scope**: Use reasonable `max_pages` values to avoid long wait times
3. **Review Content**: Check the extracted text before indexing
4. **Re-crawl Updates**: Re-crawl periodically to keep knowledge base current
5. **Respect Resources**: Avoid crawling too aggressively (built-in timeout protection)

## Integration with Knowledge System

After crawling:
1. Document is created with `source_uri` pointing to the original URL
2. Text is automatically chunked using `chunking_service`
3. Use existing `POST /knowledge/documents/{id}/index` to generate embeddings
4. Chunks become searchable via RAG system

## Testing

Run the test suite:
```bash
python test_crawler.py
```

This tests:
- Single page crawling
- Multi-page crawling
- Error handling
- Content extraction quality
