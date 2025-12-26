import { useState, useEffect } from 'react';
import { websitesApi, type WidgetConfig } from '../services/websites';
import type { Website, WebsiteCreate, WebsiteUpdate } from '../services/websites';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';

export default function WebsiteManagement() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingWebsite, setEditingWebsite] = useState<Website | null>(null);
  const [editingWidgetConfig, setEditingWidgetConfig] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<WebsiteCreate>({
    name: '',
    domain: '',
    ai_instructions: '',
  });

  const [widgetConfigData, setWidgetConfigData] = useState<WidgetConfig>({
    theme: 'dark',
    position: 'bottom-right',
    welcome_message: 'Hi! How can we help you today?',
    primary_color: '#000000',
  });

  useEffect(() => {
    loadWebsites();
  }, []);

  const loadWebsites = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await websitesApi.list();
      setWebsites(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load websites');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      await websitesApi.create(formData);
      setShowCreateForm(false);
      setFormData({ name: '', domain: '', ai_instructions: '' });
      await loadWebsites();
    } catch (err: any) {
      setError(err.message || 'Failed to create website');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWebsite) return;

    try {
      setError(null);
      const updateData: WebsiteUpdate = {};
      if (formData.name !== editingWebsite.name) updateData.name = formData.name;
      if (formData.domain !== editingWebsite.domain) updateData.domain = formData.domain;
      if (formData.ai_instructions !== (editingWebsite.ai_instructions || '')) {
        updateData.ai_instructions = formData.ai_instructions;
      }

      await websitesApi.update(editingWebsite.id, updateData);
      setEditingWebsite(null);
      setFormData({ name: '', domain: '', ai_instructions: '' });
      await loadWebsites();
    } catch (err: any) {
      setError(err.message || 'Failed to update website');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this website? This action cannot be undone.')) {
      return;
    }

    try {
      setError(null);
      await websitesApi.delete(id);
      await loadWebsites();
    } catch (err: any) {
      setError(err.message || 'Failed to delete website');
    }
  };

  const startEdit = (website: Website) => {
    setEditingWebsite(website);
    setFormData({
      name: website.name,
      domain: website.domain,
      ai_instructions: website.ai_instructions || '',
    });
    setShowCreateForm(false);
  };

  const cancelForm = () => {
    setShowCreateForm(false);
    setEditingWebsite(null);
    setEditingWidgetConfig(null);
    setFormData({ name: '', domain: '', ai_instructions: '' });
    setError(null);
  };

  const startEditWidgetConfig = async (websiteId: number) => {
    try {
      setError(null);
      const config = await websitesApi.getWidgetConfig(websiteId);
      setWidgetConfigData(config);
      setEditingWidgetConfig(websiteId);
      setShowCreateForm(false);
      setEditingWebsite(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load widget configuration');
    }
  };

  const handleWidgetConfigUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWidgetConfig) return;

    try {
      setError(null);
      await websitesApi.updateWidgetConfig(editingWidgetConfig, widgetConfigData);
      setEditingWidgetConfig(null);
      await loadWebsites();
    } catch (err: any) {
      setError(err.message || 'Failed to update widget configuration');
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Website Management</h1>
        <p className="text-gray-600">Loading websites...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Website Management</h1>
        {!showCreateForm && !editingWebsite && !editingWidgetConfig && (
          <Button onClick={() => setShowCreateForm(true)}>
            Add Website
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-800">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingWebsite) && (
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            {editingWebsite ? 'Edit Website' : 'Create Website'}
          </h2>
          <form onSubmit={editingWebsite ? handleUpdate : handleCreate}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Website Name *
                </label>
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Website"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Domain *
                </label>
                <Input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="example.com"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter the domain without protocol (e.g., example.com)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  AI Instructions
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.ai_instructions}
                  onChange={(e) =>
                    setFormData({ ...formData, ai_instructions: e.target.value })
                  }
                  placeholder="Instructions for AI to handle customer queries..."
                  rows={4}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingWebsite ? 'Update' : 'Create'}
                </Button>
                <Button type="button" variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Widget Configuration Form */}
      {editingWidgetConfig && (
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            Widget Configuration
          </h2>
          <form onSubmit={handleWidgetConfigUpdate}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Welcome Message
                </label>
                <Input
                  type="text"
                  value={widgetConfigData.welcome_message}
                  onChange={(e) => setWidgetConfigData({ ...widgetConfigData, welcome_message: e.target.value })}
                  placeholder="Hi! How can we help you today?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Theme
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={widgetConfigData.theme}
                  onChange={(e) => setWidgetConfigData({ ...widgetConfigData, theme: e.target.value })}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Position
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={widgetConfigData.position}
                  onChange={(e) => setWidgetConfigData({ ...widgetConfigData, position: e.target.value })}
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="top-left">Top Left</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Primary Color
                </label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={widgetConfigData.primary_color}
                    onChange={(e) => setWidgetConfigData({ ...widgetConfigData, primary_color: e.target.value })}
                    className="w-20 h-10"
                  />
                  <Input
                    type="text"
                    value={widgetConfigData.primary_color}
                    onChange={(e) => setWidgetConfigData({ ...widgetConfigData, primary_color: e.target.value })}
                    placeholder="#000000"
                    className="flex-1"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Color for bubble, header, and buttons
                </p>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  Update Configuration
                </Button>
                <Button type="button" variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Websites List */}
      <div className="space-y-4">
        {websites.length === 0 ? (
          <p className="text-gray-600">
            No websites yet. Click "Add Website" to create your first website.
          </p>
        ) : (
          websites.map((website) => (
            <Card key={website.id} className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{website.name}</h3>
                  <p className="text-gray-600 mt-1">
                    <span className="font-medium">Domain:</span> {website.domain}
                  </p>
                  {website.ai_instructions && (
                    <p className="text-gray-600 mt-2 text-sm">
                      <span className="font-medium">AI Instructions:</span>{' '}
                      {website.ai_instructions}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Created: {new Date(website.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEdit(website)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEditWidgetConfig(website.id)}
                  >
                    Widget Config
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(website.id)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
