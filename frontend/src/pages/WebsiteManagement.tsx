import { useState, useEffect } from 'react';
import { websitesApi, type WidgetConfig } from '../services/websites';
import type { Website, WebsiteCreate, WebsiteUpdate } from '../services/websites';
import { agentAssignmentsApi, type Agent, type WebsiteAgent } from '../services/agentAssignments';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';

export default function WebsiteManagement() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingWebsite, setEditingWebsite] = useState<Website | null>(null);
  const [editingWidgetConfig, setEditingWidgetConfig] = useState<number | null>(null);
  const [managingAgents, setManagingAgents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Agent assignment state
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [websiteAgents, setWebsiteAgents] = useState<WebsiteAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const [formData, setFormData] = useState<WebsiteCreate>({
    name: '',
    domain: '',
  });

  const [widgetConfigData, setWidgetConfigData] = useState<WidgetConfig>({
    theme: 'dark',
    position: 'bottom-right',
    welcome_message: 'Hi! How can we help you today?',
    primary_color: '#000000',
  });

  const [widgetConfigBase, setWidgetConfigBase] = useState<Record<string, any>>({});

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
      setFormData({ name: '', domain: '' });
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

      await websitesApi.update(editingWebsite.id, updateData);
      setEditingWebsite(null);
      setFormData({ name: '', domain: '' });
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
    });
    setShowCreateForm(false);
  };

  const cancelForm = () => {
    setShowCreateForm(false);
    setEditingWebsite(null);
    setEditingWidgetConfig(null);
    setManagingAgents(null);
    setFormData({ name: '', domain: '' });
    setError(null);
  };

  const startManageAgents = async (websiteId: number) => {
    try {
      setError(null);
      setLoadingAgents(true);
      const [agents, assigned] = await Promise.all([
        agentAssignmentsApi.listAgents(),
        agentAssignmentsApi.getWebsiteAgents(websiteId),
      ]);
      setAllAgents(agents);
      setWebsiteAgents(assigned);
      setManagingAgents(websiteId);
      setShowCreateForm(false);
      setEditingWebsite(null);
      setEditingWidgetConfig(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load agents');
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleAssignAgent = async (agentId: number) => {
    if (!managingAgents) return;

    try {
      setError(null);
      await agentAssignmentsApi.assignAgentToWebsite(agentId, managingAgents);
      // Reload agents
      const assigned = await agentAssignmentsApi.getWebsiteAgents(managingAgents);
      setWebsiteAgents(assigned);
    } catch (err: any) {
      setError(err.message || 'Failed to assign agent');
    }
  };

  const handleUnassignAgent = async (agentId: number) => {
    if (!managingAgents) return;

    try {
      setError(null);
      await agentAssignmentsApi.unassignAgentFromWebsite(agentId, managingAgents);
      // Reload agents
      const assigned = await agentAssignmentsApi.getWebsiteAgents(managingAgents);
      setWebsiteAgents(assigned);
    } catch (err: any) {
      setError(err.message || 'Failed to unassign agent');
    }
  };

  const startEditWidgetConfig = async (websiteId: number) => {
    try {
      setError(null);
      // Use the authenticated website endpoint (avoids public origin-locked widget-config route).
      const website = await websitesApi.get(websiteId);
      const base = (website.widget_config && typeof website.widget_config === 'object') ? website.widget_config : {};
      setWidgetConfigBase(base);
      setWidgetConfigData({
        theme: String((base as any).theme || 'dark'),
        position: String((base as any).position || 'bottom-right'),
        welcome_message: String((base as any).welcome_message || 'Hi! How can we help you today?'),
        primary_color: String((base as any).primary_color || '#000000'),
      });
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
      await websitesApi.update(editingWidgetConfig, {
        widget_config: {
          ...widgetConfigBase,
          ...widgetConfigData,
        },
      });
      setEditingWidgetConfig(null);
      // Reset widget config data to defaults
      setWidgetConfigData({
        theme: 'dark',
        position: 'bottom-right',
        welcome_message: 'Hi! How can we help you today?',
        primary_color: '#000000',
      });
      setWidgetConfigBase({});
      await loadWebsites();
    } catch (err: any) {
      setError(err.message || 'Failed to update widget configuration');
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Websites</h1>
        <p className="text-gray-600 dark:text-gray-400">Loading websites...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Websites</h1>
            <a href="/docs/admin-guide/websites" target="_blank" rel="noreferrer" title="View websites guide" className="text-gray-400 hover:text-blue-500 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
            </a>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your website integrations and chat widget configurations
          </p>
        </div>
        {!showCreateForm && !editingWebsite && !editingWidgetConfig && !managingAgents && (
          <Button onClick={() => setShowCreateForm(true)}>
            Add Website
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingWebsite) && (
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
            {editingWebsite ? 'Edit Website' : 'Create Website'}
          </h2>
          <form onSubmit={editingWebsite ? handleUpdate : handleCreate}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
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
                <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
                  Domain *
                </label>
                <Input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="example.com"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Enter the domain without protocol (e.g., example.com)
                </p>
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
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Widget Configuration</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Editing: <span className="font-semibold">{websites.find(w => w.id === editingWidgetConfig)?.name}</span>
              {' '}({websites.find(w => w.id === editingWidgetConfig)?.domain})
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Configuration Form */}
            <div>
              <form onSubmit={handleWidgetConfigUpdate}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
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
                    <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
                      Theme
                    </label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                      value={widgetConfigData.theme}
                      onChange={(e) => setWidgetConfigData({ ...widgetConfigData, theme: e.target.value })}
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
                      Position
                    </label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                      value={widgetConfigData.position}
                      onChange={(e) => setWidgetConfigData({ ...widgetConfigData, position: e.target.value })}
                    >
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-right">Bottom Right</option>
                      <option value="top-right">Top Right</option>
                      <option value="top-left">Top Left</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-white">
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
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
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
            </div>

            {/* Live Preview */}
            <div>
              <h3 className="text-sm font-medium mb-2 text-gray-900 dark:text-white">Live Preview</h3>
              <div className="relative border-2 border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 h-[500px] overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
                  Widget Preview Area
                </div>

                {/* Mock Widget Preview */}
                <div
                  className="absolute"
                  style={{
                    [widgetConfigData.position.includes('bottom') ? 'bottom' : 'top']: '20px',
                    [widgetConfigData.position.includes('right') ? 'right' : 'left']: '20px',
                  }}
                >
                  {/* Widget Bubble */}
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center cursor-pointer shadow-lg transition-transform hover:scale-110"
                    style={{ backgroundColor: widgetConfigData.primary_color }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                </div>

                {/* Expanded Widget Preview */}
                <div
                  className="absolute w-80 h-96 rounded-lg shadow-2xl flex flex-col overflow-hidden"
                  style={{
                    [widgetConfigData.position.includes('bottom') ? 'bottom' : 'top']: '90px',
                    [widgetConfigData.position.includes('right') ? 'right' : 'left']: '20px',
                  }}
                >
                  {/* Header */}
                  <div
                    className="px-4 py-3 text-white flex items-center justify-between"
                    style={{ backgroundColor: widgetConfigData.primary_color }}
                  >
                    <span className="font-medium">Support Chat</span>
                    <button className="text-white hover:opacity-80">&times;</button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 bg-white p-4 overflow-y-auto">
                    {widgetConfigData.welcome_message && (
                      <div className="mb-3">
                        <div className="inline-block bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-800">
                          {widgetConfigData.welcome_message}
                        </div>
                      </div>
                    )}
                    <div className="mb-3 flex justify-end">
                      <div
                        className="inline-block rounded-lg px-3 py-2 text-sm text-white"
                        style={{ backgroundColor: widgetConfigData.primary_color }}
                      >
                        Hello! I need help.
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="inline-block bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-800">
                        Of course! How can I assist you today?
                      </div>
                    </div>
                  </div>

                  {/* Input */}
                  <div className="bg-white border-t border-gray-200 p-3 flex gap-2">
                    <input
                      type="text"
                      placeholder="Type your message..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                      disabled
                    />
                    <button
                      className="px-4 py-2 rounded text-white text-sm font-medium"
                      style={{ backgroundColor: widgetConfigData.primary_color }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Agent Assignment Form */}
      {managingAgents && (
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            Manage Agents for {websites.find(w => w.id === managingAgents)?.name}
          </h2>

          {loadingAgents ? (
            <p className="text-gray-600">Loading agents...</p>
          ) : (
            <div className="space-y-6">
              {/* Assigned Agents */}
              <div>
                <h3 className="text-sm font-medium mb-3">Assigned Agents ({websiteAgents.length})</h3>
                {websiteAgents.length === 0 ? (
                  <p className="text-sm text-gray-500">No agents assigned yet</p>
                ) : (
                  <div className="space-y-2">
                    {websiteAgents.map((agent) => (
                      <div key={agent.id} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded">
                        <div>
                          <span className="font-medium">{agent.email}</span>
                          {agent.assigned_at && (
                            <span className="text-xs text-gray-500 ml-2">
                              Assigned: {new Date(agent.assigned_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnassignAgent(agent.id)}
                          className="text-red-600 hover:bg-red-50"
                        >
                          Unassign
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Available Agents */}
              <div>
                <h3 className="text-sm font-medium mb-3">Available Agents</h3>
                {allAgents.filter(a => !websiteAgents.find(wa => wa.id === a.id)).length === 0 ? (
                  <p className="text-sm text-gray-500">All agents are already assigned</p>
                ) : (
                  <div className="space-y-2">
                    {allAgents
                      .filter(a => !websiteAgents.find(wa => wa.id === a.id))
                      .map((agent) => (
                        <div key={agent.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded">
                          <span className="font-medium">{agent.email}</span>
                          <Button
                            size="sm"
                            onClick={() => handleAssignAgent(agent.id)}
                          >
                            Assign
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={cancelForm}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Websites Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        {websites.length === 0 ? (
          <p className="p-6 text-gray-600 dark:text-gray-400 text-center">
            No websites yet. Click "Add Website" to create your first website.
          </p>
        ) : (
          <table className="w-full min-w-[360px]">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Website
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Domain
                </th>
              </tr>
            </thead>
            <tbody>
              {websites.map((website) => (
                <tr
                  key={website.id}
                  onClick={() => startEdit(website)}
                  className="border-b border-gray-200 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                    {website.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {website.domain}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
