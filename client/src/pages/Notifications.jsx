import { useState } from 'react';
import { Bell, CheckCheck, CheckCircle2, Clock, Info, AlertCircle, Sparkles, Filter } from 'lucide-react';
import { apiFetch } from '../api';
import { Empty, ErrorText, Loading, Panel, fmtDateTime, useApi } from '../ui';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return fmtDateTime(dateStr);
}

export default function Notifications() {
  const { data, error, loading, reload } = useApi('/notifications');
  const [filter, setFilter] = useState('all'); // 'all' or 'unread'
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const list = data || [];
  const unreadList = list.filter(n => !n.read_at);
  const displayed = filter === 'unread' ? unreadList : list;

  const markOneRead = async (n) => {
    if (n.read_at) return;
    try {
      await apiFetch(`/notifications/${n.id}/read`, { method: 'PATCH' });
      reload();
    } catch (_) {}
  };

  const markAllRead = async () => {
    if (!unreadList.length || busy) return;
    setBusy(true);
    try {
      await apiFetch('/notifications/read-all', { method: 'POST' });
      reload();
    } catch (_) {}
    finally {
      setBusy(false);
    }
  };

  const testAlert = async () => {
    setTesting(true);
    try {
      await apiFetch('/notifications/test', { method: 'POST' });
      await reload();
    } catch (e) {
      alert(e.message || 'Failed to send test alert');
    } finally {
      setTesting(false);
    }
  };

  if (loading && !data) return <Loading text="Loading notifications…" />;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header Banner */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        padding: '20px 24px',
        marginBottom: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: '#eff6ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2563eb'
          }}>
            <Bell size={22} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 750, color: '#0f172a' }}>
              Notifications
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              Stay informed about class sessions, module additions and attendance reviews.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={testAlert}
            disabled={testing}
            title="Send an immediate test alert to this phone/browser"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid #a7f3d0',
              background: '#ecfdf5',
              color: '#059669',
              fontSize: 12,
              fontWeight: 650,
              cursor: 'pointer'
            }}
          >
            <Sparkles size={16} />
            {testing ? 'Sending Test…' : 'Test Mobile Alert'}
          </button>

          {unreadList.length > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={busy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid #bae6fd',
                background: '#f0f9ff',
                color: '#0284c7',
                fontSize: 12,
                fontWeight: 650,
                cursor: 'pointer'
              }}
            >
              <CheckCheck size={16} />
              {busy ? 'Marking…' : 'Mark all as read'}
            </button>
          )}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setFilter('all')}
          style={{
            padding: '6px 14px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: filter === 'all' ? 700 : 500,
            background: filter === 'all' ? '#2563eb' : '#f1f5f9',
            color: filter === 'all' ? '#ffffff' : '#475569',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          All ({list.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          style={{
            padding: '6px 14px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: filter === 'unread' ? 700 : 500,
            background: filter === 'unread' ? '#2563eb' : '#f1f5f9',
            color: filter === 'unread' ? '#ffffff' : '#475569',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Unread ({unreadList.length})
        </button>
      </div>

      {/* Notifications List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!displayed.length ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            background: '#ffffff',
            borderRadius: 16,
            border: '1px solid #e2e8f0'
          }}>
            <Bell size={36} color="#94a3b8" style={{ margin: '0 auto 10px' }} />
            <strong style={{ display: 'block', fontSize: 14, color: '#334155' }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </strong>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
              {filter === 'unread' ? 'All caught up! Check back later.' : 'Updates from lecturers and your department will appear here.'}
            </p>
          </div>
        ) : (
          displayed.map(n => {
            const isUnread = !n.read_at;
            const isWarning = n.title?.toLowerCase().includes('warning') || n.title?.toLowerCase().includes('urgent');
            const isSuccess = n.title?.toLowerCase().includes('approved') || n.title?.toLowerCase().includes('success');

            return (
              <div
                key={n.id}
                onClick={() => markOneRead(n)}
                style={{
                  background: isUnread ? '#f8fafc' : '#ffffff',
                  border: isUnread ? '1.5px solid #bfdbfe' : '1px solid #e2e8f0',
                  borderRadius: 14,
                  padding: '16px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  cursor: isUnread ? 'pointer' : 'default',
                  boxShadow: isUnread ? '0 2px 8px rgba(37,99,235,0.06)' : '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.15s ease'
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: isWarning ? '#fef2f2' : isSuccess ? '#f0fdf4' : '#eff6ff',
                  color: isWarning ? '#dc2626' : isSuccess ? '#16a34a' : '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {isWarning ? <AlertCircle size={18} /> : isSuccess ? <CheckCircle2 size={18} /> : <Info size={18} />}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                    <strong style={{ fontSize: 14, color: isUnread ? '#0f172a' : '#334155', fontWeight: isUnread ? 750 : 600 }}>
                      {n.title}
                    </strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {timeAgo(n.created_at)}
                      </span>
                      {isUnread && (
                        <span style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#2563eb',
                          boxShadow: '0 0 0 2px #dbeafe'
                        }} />
                      )}
                    </div>
                  </div>

                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569', lineHeight: 1.45 }}>
                    {n.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
