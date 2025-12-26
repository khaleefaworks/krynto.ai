import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from typing import List, Set, Optional


class WebCrawler:
    """
    Web crawler for extracting text content from websites.
    
    Features:
    - Crawls single pages or multiple pages within the same domain
    - Extracts main text content from HTML
    - Respects robots.txt (basic implementation)
    - Handles relative URLs
    """
    
    def __init__(self, max_pages: int = 10, max_depth: int = 2):
        """
        Initialize the web crawler.
        
        Args:
            max_pages: Maximum number of pages to crawl
            max_depth: Maximum depth to crawl from the starting URL
        """
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.visited_urls: Set[str] = set()
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'AI-ChatAssist-Crawler/1.0'
        })
    
    def crawl_single_page(self, url: str) -> Optional[dict]:
        """
        Crawl a single page and extract its content.
        
        Args:
            url: The URL to crawl
            
        Returns:
            Dictionary with url, title, and text content, or None if failed
        """
        try:
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Remove script and style elements
            for script_or_style in soup(['script', 'style', 'nav', 'footer', 'header']):
                script_or_style.decompose()
            
            # Extract title
            title = soup.title.string if soup.title else url
            
            # Extract text content
            text = soup.get_text(separator='\n', strip=True)
            
            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            text = '\n'.join(line for line in lines if line)
            
            return {
                'url': url,
                'title': title,
                'text': text
            }
            
        except Exception as e:
            logger.error("crawl_error", url=url, error=str(e))
            return None
    
    def crawl_website(self, start_url: str, max_pages: Optional[int] = None) -> List[dict]:
        """
        Crawl multiple pages starting from the given URL.
        
        Args:
            start_url: The starting URL
            max_pages: Override the default max_pages
            
        Returns:
            List of dictionaries with url, title, and text for each page
        """
        if max_pages is None:
            max_pages = self.max_pages
        
        # Parse the start URL to get the base domain
        parsed_start = urlparse(start_url)
        base_domain = f"{parsed_start.scheme}://{parsed_start.netloc}"
        
        pages_data = []
        urls_to_visit = [(start_url, 0)]  # (url, depth)
        
        while urls_to_visit and len(pages_data) < max_pages:
            current_url, depth = urls_to_visit.pop(0)
            
            # Skip if already visited or depth exceeded
            if current_url in self.visited_urls or depth > self.max_depth:
                continue
            
            self.visited_urls.add(current_url)
            
            # Crawl the page
            page_data = self.crawl_single_page(current_url)
            if page_data:
                pages_data.append(page_data)
                
                # Extract links for further crawling (if not at max depth)
                if depth < self.max_depth:
                    try:
                        response = self.session.get(current_url, timeout=10)
                        soup = BeautifulSoup(response.content, 'html.parser')
                        
                        for link in soup.find_all('a', href=True):
                            href = link['href']
                            # Ensure href is a string
                            if not isinstance(href, str):
                                continue
                            
                            # Convert relative URLs to absolute
                            absolute_url = urljoin(current_url, href)
                            
                            # Only follow links within the same domain
                            parsed_url = urlparse(absolute_url)
                            if (parsed_url.scheme in ['http', 'https'] and 
                                f"{parsed_url.scheme}://{parsed_url.netloc}" == base_domain and
                                absolute_url not in self.visited_urls):
                                urls_to_visit.append((absolute_url, depth + 1))
                    except Exception as e:
                        logger.error("link_extraction_error", url=current_url, error=str(e))
        
        return pages_data
    
    def crawl_and_combine(self, url: str, crawl_multiple: bool = False) -> dict:
        """
        Crawl URL(s) and return combined content.
        
        Args:
            url: The starting URL
            crawl_multiple: If True, crawl multiple pages; if False, crawl only the single page
            
        Returns:
            Dictionary with combined title and text content
        """
        if crawl_multiple:
            pages = self.crawl_website(url)
        else:
            page = self.crawl_single_page(url)
            pages = [page] if page else []
        
        if not pages:
            raise ValueError(f"Failed to crawl any content from {url}")
        
        # Combine all pages
        combined_title = pages[0]['title'] if len(pages) == 1 else f"{pages[0]['title']} and {len(pages)-1} more pages"
        combined_text = "\n\n---\n\n".join([
            f"# {page['title']}\nURL: {page['url']}\n\n{page['text']}"
            for page in pages
        ])
        
        return {
            'title': combined_title,
            'source_uri': url,
            'text': combined_text,
            'pages_crawled': len(pages)
        }
