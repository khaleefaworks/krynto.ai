import { useState, useEffect } from 'react';
import { websitesApi, type Website } from '../services/websites';
import { knowledgeApi, type DocumentListItem } from '../services/knowledge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';

export default function KnowledgeManagement() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [selectedWebsite, setSelectedWebsite] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Document list state
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  
  // Source creation state
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceId, setSourceId] = useState<number | null>(null);

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Text input state
  const [showTextForm, setShowTextForm] = useState(false);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');

  // Crawl state
  const [showCrawlForm, setShowCrawlForm] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlMultiple, setCrawlMultiple] = useState(false);
  const [crawlMaxPages, setCrawlMaxPages] = useState(10);
  const [crawling, setCrawling] = useState(false);

  useEffect(() => {
    loadWebsites();
  }, []);

  useEffect(() => {
    if (selectedWebsite) {
      loadDocuments();
    }
  }, [selectedWebsite]);

  const loadWebsites = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await websitesApi.list();
      setWebsites(data);
      if (data.length > 0 && !selectedWebsite) {
        setSelectedWebsite(data[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load websites');
    } finally {
      setLoading(false);
    }
  };

  const loadDocuments = async () => {
    if (!selectedWebsite) return;

    try {
      setLoadingDocuments(true);
      const docs = await knowledgeApi.listDocuments(selectedWebsite);
      setDocuments(docs);
    } catch (err: any) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoadingDocuments(false);
    }
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWebsite || !sourceName) return;

    try {
      setError(null);
      setSuccess(null);
      const result = await knowledgeApi.createSource({
        website_id: selectedWebsite,
        name: sourceName,
        source_type: 'manual',
      });
      setSourceId(result.id);
      setSourceName('');
      setShowSourceForm(false);
      setSuccess(`Knowledge source "${result.name}" created successfully!`);
    } catch (err: any) {
      setError(err.message || 'Failed to create knowledge source');
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWebsite || !selectedFile) return;

    // Create source if not exists
    let currentSourceId = sourceId;
    if (!currentSourceId) {
      try {
        const result = await knowledgeApi.createSource({
          website_id: selectedWebsite,
          name: 'Uploaded Documents',
          source_type: 'manual',
        });
        currentSourceId = result.id;
        setSourceId(result.id);
      } catch (err: any) {
        setError(err.message || 'Failed to create knowledge source');
        return;
      }
    }

    try {
      setUploading(true);
      setError(null);
      setSuccess(null);

      const uploadResult = await knowledgeApi.uploadDocument(
        selectedWebsite,
        currentSourceId,
        selectedFile
      );

      console.log('Upload result:', uploadResult);

      // Auto-index after upload
      if (uploadResult.document_id) {
        try {
          await knowledgeApi.indexDocument(uploadResult.document_id, selectedWebsite);
          setSuccess(
            `Successfully uploaded "${uploadResult.title}" - ${uploadResult.chunks_created} chunks created and indexed!`
          );
        } catch (indexError: any) {
          // Upload succeeded but indexing failed
          setError(
            `Upload succeeded but indexing failed: ${indexError.message}. The document was created but you'll need to index it manually or check your OpenAI API key.`
          );
        }
      } else {
        setSuccess(
          `Successfully uploaded "${uploadResult.title}" - ${uploadResult.chunks_created} chunks created! (Indexing skipped)`
        );
      }

      setSelectedFile(null);
      
      // Reset file input
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      
      // Reload document list
      await loadDocuments();
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleTextIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWebsite || !textTitle || !textContent) return;

    // Create source if not exists
    let currentSourceId = sourceId;
    if (!currentSourceId) {
      try {
        const result = await knowledgeApi.createSource({
          website_id: selectedWebsite,
          name: 'Text Documents',
          source_type: 'manual',
        });
        currentSourceId = result.id;
        setSourceId(result.id);
      } catch (err: any) {
        setError(err.message || 'Failed to create knowledge source');
        return;
      }
    }

    try {
      setUploading(true);
      setError(null);
      setSuccess(null);

      const ingestResult = await knowledgeApi.ingestText({
        website_id: selectedWebsite,
        knowledge_source_id: currentSourceId,
        title: textTitle,
        text: textContent,
      });

      console.log('Ingest result:', ingestResult);

      // Auto-index after ingest
      if (ingestResult.document_id) {
        try {
          await knowledgeApi.indexDocument(ingestResult.document_id, selectedWebsite);
          setSuccess(
            `Successfully ingested "${ingestResult.title}" - ${ingestResult.chunks_created} chunks created and indexed!`
          );
        } catch (indexError: any) {
          // Ingest succeeded but indexing failed
          setError(
            `Ingest succeeded but indexing failed: ${indexError.message}. The document was created but you'll need to index it manually or check your OpenAI API key.`
          );
        }
      } else {
        setSuccess(
          `Successfully ingested "${ingestResult.title}" - ${ingestResult.chunks_created} chunks created! (Indexing skipped)`
        );
      }

      setTextTitle('');
      setTextContent('');
      setShowTextForm(false);
      
      // Reload document list
      await loadDocuments();
    } catch (err: any) {
      console.error('Ingest error:', err);
      setError(err.message || 'Text ingest failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (documentId: number, title: string) => {
    if (!selectedWebsite) return;

    if (!confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      await knowledgeApi.deleteDocument(documentId, selectedWebsite);
      setSuccess(`Document "${title}" deleted successfully`);
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || 'Failed to delete document');
    }
  };

  const handleReindexDocument = async (documentId: number, title: string) => {
    if (!selectedWebsite) return;

    try {
      setError(null);
      setSuccess(null);
      await knowledgeApi.indexDocument(documentId, selectedWebsite);
      setSuccess(`Document "${title}" reindexed successfully`);
    } catch (err: any) {
      setError(err.message || 'Failed to reindex document');
    }
  };

  const handleCrawlWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWebsite || !crawlUrl) return;

    // Create source if not exists
    let currentSourceId = sourceId;
    if (!currentSourceId) {
      try {
        const result = await knowledgeApi.createSource({
          website_id: selectedWebsite,
          name: 'Crawled Content',
          source_type: 'crawl',
        });
        currentSourceId = result.id;
        setSourceId(result.id);
      } catch (err: any) {
        setError(err.message || 'Failed to create knowledge source');
        return;
      }
    }

    try {
      setCrawling(true);
      setError(null);
      setSuccess(null);

      const crawlResult = await knowledgeApi.crawlWebsite({
        website_id: selectedWebsite,
        knowledge_source_id: currentSourceId,
        url: crawlUrl,
        crawl_multiple: crawlMultiple,
        max_pages: crawlMaxPages,
      });

      console.log('Crawl result:', crawlResult);

      // Auto-index after crawl
      if (crawlResult.document_id) {
        try {
          await knowledgeApi.indexDocument(crawlResult.document_id, selectedWebsite);
          setSuccess(
            `Successfully crawled "${crawlResult.title}" - ${crawlResult.pages_crawled} page(s), ${crawlResult.chunks_created} chunks created and indexed!`
          );
        } catch (indexError: any) {
          // Crawl succeeded but indexing failed
          setError(
            `Crawl succeeded but indexing failed: ${indexError.message}. The document was created but you'll need to index it manually or check your OpenAI API key.`
          );
        }
      } else {
        setSuccess(
          `Successfully crawled "${crawlResult.title}" - ${crawlResult.pages_crawled} page(s), ${crawlResult.chunks_created} chunks created! (Indexing skipped)`
        );
      }

      setCrawlUrl('');
      setShowCrawlForm(false);
      
      // Reload document list
      await loadDocuments();
    } catch (err: any) {
      console.error('Crawl error:', err);
      setError(err.message || 'Website crawl failed');
    } finally {
      setCrawling(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Knowledge Management</h1>
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Knowledge Management</h1>

      {/* Website Selector */}
      <Card className="p-6 mb-6">
        <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Select Website</label>
        <select
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          value={selectedWebsite || ''}
          onChange={(e) => {
            setSelectedWebsite(Number(e.target.value));
            setSourceId(null); // Reset source when switching websites
          }}
        >
          {websites.map((website) => (
            <option key={website.id} value={website.id}>
              {website.name} ({website.domain})
            </option>
          ))}
        </select>
      </Card>

      {/* Status Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md text-green-800 dark:text-green-300">
          {success}
        </div>
      )}

      {/* Upload Options */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* File Upload */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Upload Document</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Upload PDF or TXT files to add to the knowledge base
          </p>
          <form onSubmit={handleFileUpload}>
            <div className="space-y-4">
              <div>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.txt"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  disabled={uploading}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Supported formats: PDF, TXT
                </p>
              </div>
              <Button type="submit" disabled={!selectedFile || uploading}>
                {uploading ? 'Uploading...' : 'Upload & Index'}
              </Button>
            </div>
          </form>
        </Card>

        {/* Text Input */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Add Text Content</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Add FAQ, policies, or any text content directly
          </p>
          {!showTextForm ? (
            <Button onClick={() => setShowTextForm(true)}>
              Add Text Content
            </Button>
          ) : (
            <form onSubmit={handleTextIngest}>
              <div className="space-y-4">
                <Input
                  type="text"
                  placeholder="Document title"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  disabled={uploading}
                  required
                />
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  rows={4}
                  placeholder="Enter your text content here..."
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  disabled={uploading}
                  required
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={uploading}>
                    {uploading ? 'Processing...' : 'Add & Index'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowTextForm(false);
                      setTextTitle('');
                      setTextContent('');
                    }}
                    disabled={uploading}
                    className="bg-gray-500 hover:bg-gray-600"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Card>

        {/* Website Crawl */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Crawl Website</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Extract knowledge from a website URL
          </p>
          {!showCrawlForm ? (
            <Button onClick={() => setShowCrawlForm(true)}>
              Crawl Website
            </Button>
          ) : (
            <form onSubmit={handleCrawlWebsite}>
              <div className="space-y-4">
                <Input
                  type="url"
                  placeholder="https://example.com/docs"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                  disabled={crawling}
                  required
                />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="crawl-multiple"
                    checked={crawlMultiple}
                    onChange={(e) => setCrawlMultiple(e.target.checked)}
                    disabled={crawling}
                    className="rounded"
                  />
                  <label htmlFor="crawl-multiple" className="text-sm text-gray-900 dark:text-white">
                    Crawl multiple pages
                  </label>
                </div>
                {crawlMultiple && (
                  <div>
                    <label className="block text-sm mb-1 text-gray-900 dark:text-white">
                      Max pages: {crawlMaxPages}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={crawlMaxPages}
                      onChange={(e) => setCrawlMaxPages(Number(e.target.value))}
                      disabled={crawling}
                      className="w-full"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={crawling}>
                    {crawling ? 'Crawling...' : 'Crawl & Index'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowCrawlForm(false);
                      setCrawlUrl('');
                      setCrawlMultiple(false);
                      setCrawlMaxPages(10);
                    }}
                    disabled={crawling}
                    className="bg-gray-500 hover:bg-gray-600"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Card>
      </div>

      {/* Info Section */}
      <Card className="p-6 bg-blue-50 border-blue-200 mb-6">
        <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Upload PDFs/TXT files, add text directly, or crawl website URLs</li>
          <li>• Documents are automatically chunked into smaller pieces</li>
          <li>• Each chunk is embedded using OpenAI embeddings</li>
          <li>• Embeddings are stored in Chroma vector database</li>
          <li>• AI retrieves relevant chunks when answering questions</li>
          <li>• Knowledge is isolated per website</li>
        </ul>
      </Card>

      {/* Document List */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Indexed Documents</h2>
          {loadingDocuments && <span className="text-sm text-gray-500">Loading...</span>}
        </div>

        {documents.length === 0 ? (
          <p className="text-gray-600 text-sm">
            No documents yet. Upload files or add text content to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{doc.title}</h3>
                    <div className="flex gap-4 mt-2 text-sm text-gray-600">
                      <span>📄 {doc.chunk_count} chunks</span>
                      <span>📊 {(doc.text_length / 1000).toFixed(1)}K chars</span>
                      {doc.created_at && (
                        <span>📅 {new Date(doc.created_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReindexDocument(doc.id, doc.title)}
                      disabled={uploading}
                    >
                      Reindex
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteDocument(doc.id, doc.title)}
                      className="text-red-600 hover:bg-red-50"
                      disabled={uploading}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
