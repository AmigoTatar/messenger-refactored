// hooks/useUnread.js
import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../services/apiClient';

export function useUnread(user) {
  const [unreadCounts, setUnreadCounts] = useState({});

  const fetchUnread = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiClient('/api/unread');
      setUnreadCounts(data);
    } catch (err) {
      console.error('Error fetching unread:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  const updateUnread = useCallback((chatKey, delta = 1) => {
    setUnreadCounts(prev => ({
      ...prev,
      [chatKey]: Math.max((prev[chatKey] || 0) + delta, 0),
    }));
  }, []);

  const resetUnread = useCallback((chatKey) => {
    setUnreadCounts(prev => ({ ...prev, [chatKey]: 0 }));
  }, []);

  return { unreadCounts, fetchUnread, updateUnread, resetUnread };
}