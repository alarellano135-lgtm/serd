import React, { useState, useMemo } from 'react';
import { Screen } from '../types';
import { useUserSettings, EmergencyCircleContact } from '../lib/userSettings';
import { useAuth } from '../contexts/AuthContext';
import { syncUserProfileToFirestore } from '../lib/firebase';

interface ContactsProps {
  onNavigate?: (screen: Screen) => void;
}

const RELATIONSHIP_OPTIONS = [
  'Spouse',
  'Parent',
  'Sibling',
  'Child',
  'Partner',
  'Friend',
  'Relative',
  'Doctor / Physician',
  'Caregiver',
  'Neighbor',
  'Colleague',
  'Other'
];

export default function Contacts({ onNavigate }: ContactsProps) {
  const { settings, updateEmergencyCircle } = useUserSettings();
  const { darkMode, profile, location } = settings;
  const { currentUser } = useAuth();

  // Real contacts from user settings
  const contacts: EmergencyCircleContact[] = useMemo(() => {
    return profile.emergencyCircle || [];
  }, [profile.emergencyCircle]);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyCircleContact | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRelation, setFormRelation] = useState('Spouse');
  const [formIsPrimary, setFormIsPrimary] = useState(false);
  const [formNotes, setFormNotes] = useState('');

  // Check if device Contact Picker API is supported (Android Chrome / mobile browsers)
  const isContactPickerSupported = typeof navigator !== 'undefined' && 
    'contacts' in navigator && 
    typeof (navigator as any).contacts?.select === 'function';

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // Synchronize changes to local settings & cloud profile
  const persistContacts = async (updatedList: EmergencyCircleContact[]) => {
    updateEmergencyCircle(updatedList);

    if (currentUser?.uid) {
      const primaryContact = updatedList.find(c => c.isPrimary) || updatedList[0];
      try {
        await syncUserProfileToFirestore({
          uid: currentUser.uid,
          fullName: profile.fullName || 'Registered Citizen',
          displayName: profile.displayName || 'Citizen',
          email: profile.email || currentUser.email || '',
          emergencyCircle: updatedList,
          ...(primaryContact ? {
            emergencyContact: {
              name: primaryContact.name,
              phone: primaryContact.phone,
              relation: primaryContact.relation || 'Emergency Contact'
            }
          } : {
            emergencyContact: {
              name: '',
              phone: '',
              relation: ''
            }
          })
        });
      } catch (err) {
        console.warn('Failed to sync contacts to cloud profile:', err);
      }
    }
  };

  // Open modal for adding a new contact
  const handleOpenAddModal = () => {
    setEditingContact(null);
    setFormName('');
    setFormPhone('');
    setFormRelation(contacts.length === 0 ? 'Spouse' : 'Relative');
    setFormIsPrimary(contacts.length === 0); // Default to primary if first contact
    setFormNotes('');
    setIsAddModalOpen(true);
  };

  // Open modal for editing an existing contact
  const handleOpenEditModal = (contact: EmergencyCircleContact) => {
    setEditingContact(contact);
    setFormName(contact.name);
    setFormPhone(contact.phone);
    setFormRelation(contact.relation || 'Other');
    setFormIsPrimary(Boolean(contact.isPrimary));
    setFormNotes(contact.notes || '');
    setIsAddModalOpen(true);
  };

  // Save (Create or Update) contact
  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) return;

    let updatedList: EmergencyCircleContact[];

    if (editingContact) {
      // Update existing
      updatedList = contacts.map(c => {
        if (c.id === editingContact.id) {
          return {
            ...c,
            name: formName.trim(),
            phone: formPhone.trim(),
            relation: formRelation,
            isPrimary: formIsPrimary,
            notes: formNotes.trim() || undefined
          };
        }
        // If this contact is marked primary, unmark others
        return formIsPrimary ? { ...c, isPrimary: false } : c;
      });
      showToast('Contact updated successfully');
    } else {
      // Create new
      const newContact: EmergencyCircleContact = {
        id: 'contact_' + Date.now().toString(),
        name: formName.trim(),
        phone: formPhone.trim(),
        relation: formRelation,
        isPrimary: formIsPrimary,
        notes: formNotes.trim() || undefined,
        createdAt: Date.now()
      };

      if (formIsPrimary) {
        updatedList = [...contacts.map(c => ({ ...c, isPrimary: false })), newContact];
      } else {
        updatedList = [...contacts, newContact];
      }
      showToast('New emergency contact added');
    }

    // Ensure at least one is marked primary if list not empty
    if (updatedList.length > 0 && !updatedList.some(c => c.isPrimary)) {
      updatedList[0].isPrimary = true;
    }

    await persistContacts(updatedList);
    setIsAddModalOpen(false);
  };

  // Delete a contact
  const handleDeleteContact = async (id: string) => {
    const contactToDelete = contacts.find(c => c.id === id);
    let updatedList = contacts.filter(c => c.id !== id);

    // If deleted contact was primary, promote the first remaining
    if (contactToDelete?.isPrimary && updatedList.length > 0) {
      updatedList[0].isPrimary = true;
    }

    await persistContacts(updatedList);
    setDeleteConfirmId(null);
    showToast('Emergency contact removed');
  };

  // Promote contact to Primary
  const handleSetPrimary = async (id: string) => {
    const updatedList = contacts.map(c => ({
      ...c,
      isPrimary: c.id === id
    }));
    await persistContacts(updatedList);
    showToast('Set as primary emergency contact');
  };

  // Native Device Contact Picker (Mobile Web)
  const handleImportDeviceContact = async () => {
    if (!isContactPickerSupported) return;

    try {
      const selected = await (navigator as any).contacts.select(['name', 'tel'], { multiple: false });
      if (selected && selected.length > 0) {
        const item = selected[0];
        const name = (item.name && item.name[0]) || '';
        const phone = (item.tel && item.tel[0]) || '';

        if (name || phone) {
          setEditingContact(null);
          setFormName(name);
          setFormPhone(phone);
          setFormRelation('Relative');
          setFormIsPrimary(contacts.length === 0);
          setFormNotes('Imported from phone contacts');
          setIsAddModalOpen(true);
        }
      }
    } catch (err) {
      // User cancelled picker or permission denied
      console.info('Device contact picker cancelled or dismissed:', err);
    }
  };

  // Build emergency alert SMS URL
  const getEmergencySmsUrl = (contact: EmergencyCircleContact) => {
    const patientName = profile.fullName || profile.displayName || 'Citizen';
    const locAddress = location.lastKnownAddress || 'Current GPS Location';
    const body = `EMERGENCY ALERT: This is ${patientName}. I am in an emergency situation and need assistance. My last reported location: ${locAddress}. Please contact or check on me immediately.`;
    return `sms:${contact.phone}?body=${encodeURIComponent(body)}`;
  };



  // Filtered contacts based on search query
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(c => 
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.relation && c.relation.toLowerCase().includes(q))
    );
  }, [contacts, searchQuery]);

  return (
    <div className={`flex flex-col h-full ${darkMode ? 'bg-neutral-950 text-neutral-100' : 'bg-[#FAFAFA] text-gray-900'} px-4 sm:px-6 pt-5 pb-8 overflow-y-auto relative transition-colors`}>
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-semibold px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-[fade-in_0.15s_ease-out]">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Action Bar */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Emergency Circle ({contacts.length})
          </span>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
            Contacts notified and reachable during an emergency
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isContactPickerSupported && (
            <button
              onClick={handleImportDeviceContact}
              className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:bg-neutral-50 transition-colors"
            >
              Import
            </button>
          )}

          <button
            id="add-contact-btn"
            onClick={handleOpenAddModal}
            className="px-3 py-1.5 rounded-lg bg-[#B41A46] text-white text-xs font-semibold hover:bg-[#9a143a] transition-colors cursor-pointer"
          >
            Add Contact
          </button>
        </div>
      </div>

      {/* Search Bar (Shown when multiple contacts exist) */}
      {contacts.length > 2 && (
        <div className="relative mb-3.5 px-1 flex items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium border focus:outline-none focus:border-[#B41A46] ${
              darkMode 
                ? 'bg-neutral-900 border-neutral-800 text-white placeholder:text-neutral-500' 
                : 'bg-white border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 text-xs font-semibold text-neutral-400 hover:text-neutral-600"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Contact List */}
      <div className="space-y-3 flex-1 overflow-y-auto pr-0.5 pb-4">
        {contacts.length === 0 ? (
          /* Clean Empty State */
          <div className={`p-8 text-center rounded-2xl border border-dashed my-4 ${
            darkMode ? 'bg-neutral-900/40 border-neutral-800' : 'bg-white border-neutral-200'
          }`}>
            <h3 className="font-bold text-sm text-neutral-900 dark:text-white mb-1">
              No Emergency Contacts
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto mb-5 leading-relaxed">
              Add trusted family members or friends who will be notified and directly reachable during emergencies.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <button
                onClick={handleOpenAddModal}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#B41A46] hover:bg-[#9a143a] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Add Contact
              </button>

              {isContactPickerSupported && (
                <button
                  onClick={handleImportDeviceContact}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-semibold hover:bg-neutral-50"
                >
                  Import from Phone
                </button>
              )}
            </div>
          </div>
        ) : filteredContacts.length === 0 ? (
          /* Search Empty State */
          <div className="p-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
            No contacts found matching "{searchQuery}".
          </div>
        ) : (
          /* Real Contacts Cards */
          filteredContacts.map((contact) => (
            <div 
              key={contact.id} 
              className={`p-4 rounded-xl border transition-all ${
                darkMode 
                  ? 'bg-neutral-900 border-neutral-800' 
                  : 'bg-white border-neutral-200/80'
              } ${contact.isPrimary ? 'border-neutral-300 dark:border-neutral-700' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm text-neutral-900 dark:text-white truncate">
                      {contact.name}
                    </h3>
                    {contact.isPrimary && (
                      <span className="text-[10px] font-bold text-[#B41A46] dark:text-rose-400">
                        Primary
                      </span>
                    )}
                  </div>

                  <p className="text-neutral-600 dark:text-neutral-400 text-xs mt-0.5 font-mono">
                    {contact.phone}
                  </p>

                  <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    <span>{contact.relation || 'Emergency Contact'}</span>
                    {contact.notes && (
                      <span className="truncate max-w-[150px]">
                        &middot; {contact.notes}
                      </span>
                    )}
                  </div>
                </div>

                {/* Direct Action Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={getEmergencySmsUrl(contact)}
                    className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:border-neutral-300 transition-colors"
                  >
                    SMS
                  </a>

                  <a
                    href={`tel:${contact.phone}`}
                    className="px-2.5 py-1.5 rounded-lg bg-[#B41A46] text-white text-xs font-semibold hover:bg-[#9a143a] transition-colors"
                  >
                    Call
                  </a>
                </div>
              </div>

              {/* Management Controls Footer */}
              <div className="mt-3 pt-2.5 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                <div>
                  {!contact.isPrimary ? (
                    <button
                      onClick={() => handleSetPrimary(contact.id)}
                      className="text-[11px] font-semibold text-neutral-500 hover:text-[#B41A46] dark:hover:text-rose-400 transition-colors cursor-pointer"
                    >
                      Make Primary
                    </button>
                  ) : (
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      Primary Contact
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleOpenEditModal(contact)}
                    className="text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => setDeleteConfirmId(contact.id)}
                    className="text-[11px] font-medium text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-[fade-in_0.15s_ease-out]">
          <div className={`${darkMode ? 'bg-neutral-900 border-neutral-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'} w-full max-w-sm rounded-2xl p-6 shadow-2xl border space-y-4`}>
            <div>
              <h3 className="font-bold text-sm text-neutral-900 dark:text-white">Remove Emergency Contact</h3>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Are you sure you want to remove this contact from your emergency circle? They will no longer be notified during an incident.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteContact(deleteConfirmId)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors"
              >
                Remove Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Contact Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-[fade-in_0.15s_ease-out]">
          <div className={`${darkMode ? 'bg-neutral-900 border-neutral-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'} w-full sm:max-w-md rounded-t-[28px] sm:rounded-2xl p-6 shadow-2xl border-t sm:border relative max-h-[92vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold leading-tight">
                  {editingContact ? 'Edit Emergency Contact' : 'Add Emergency Contact'}
                </h2>
                <p className="text-[11px] text-neutral-400">
                  Trusted contact for dispatch alerts
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs font-semibold text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 px-2 py-1"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveContact} className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-bold tracking-wider uppercase text-neutral-500 dark:text-neutral-400 mb-1.5">
                  Full Name <span className="text-[#B41A46]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Maria Santos"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className={`w-full px-3.5 py-2.5 border rounded-xl text-xs sm:text-sm focus:outline-none focus:border-[#B41A46] font-medium ${
                    darkMode ? 'bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' : 'bg-neutral-50 border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-bold tracking-wider uppercase text-neutral-500 dark:text-neutral-400 mb-1.5">
                  Phone Number <span className="text-[#B41A46]">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. +63 917 123 4567"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className={`w-full px-3.5 py-2.5 border rounded-xl text-xs sm:text-sm focus:outline-none focus:border-[#B41A46] font-medium ${
                    darkMode ? 'bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' : 'bg-neutral-50 border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />
              </div>

              {/* Relationship Dropdown */}
              <div>
                <label className="block text-xs font-bold tracking-wider uppercase text-neutral-500 dark:text-neutral-400 mb-1.5">
                  Relationship
                </label>
                <select
                  value={formRelation}
                  onChange={(e) => setFormRelation(e.target.value)}
                  className={`w-full px-3.5 py-2.5 border rounded-xl text-xs sm:text-sm focus:outline-none focus:border-[#B41A46] font-medium ${
                    darkMode ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-neutral-50 border-neutral-200 text-neutral-900'
                  }`}
                >
                  {RELATIONSHIP_OPTIONS.map((rel) => (
                    <option key={rel} value={rel}>{rel}</option>
                  ))}
                </select>
              </div>

              {/* Notes or Instructions */}
              <div>
                <label className="block text-xs font-bold tracking-wider uppercase text-neutral-500 dark:text-neutral-400 mb-1.5">
                  Emergency Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Has spare keys, lives nearby"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className={`w-full px-3.5 py-2.5 border rounded-xl text-xs focus:outline-none focus:border-[#B41A46] font-medium ${
                    darkMode ? 'bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500' : 'bg-neutral-50 border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
                  }`}
                />
              </div>

              {/* Primary Contact Checkbox */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsPrimary}
                  onChange={(e) => setFormIsPrimary(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#B41A46] rounded cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-neutral-900 dark:text-white block">
                    Set as Primary Emergency Contact
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-tight block mt-0.5">
                    Will be synced to your Medical ID and given first priority during dispatch alerts.
                  </span>
                </div>
              </label>

              {/* Submit Button */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-[#B41A46] hover:bg-[#9a143a] text-white font-bold text-xs sm:text-sm transition-colors cursor-pointer"
                >
                  {editingContact ? 'Save Changes' : 'Add to Circle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
