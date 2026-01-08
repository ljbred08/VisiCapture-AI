
import React, { useState } from 'react';
import { Contact } from '../types';
import * as XLSX from 'xlsx';

interface ResultsTableProps {
  contacts: Contact[];
  onUpdate: (updatedContacts: Contact[]) => void;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ contacts, onUpdate }) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Contact | null>(null);

  // Determine headers dynamically based on data keys
  const getHeaders = () => {
    if (contacts.length === 0) return [];
    const allKeys = new Set<string>();
    contacts.forEach(c => Object.keys(c).forEach(k => allKeys.add(k)));
    
    // Prioritize contact-like keys if they exist
    const preferredOrder = ['name', 'item_name', 'phone', 'email', 'role', 'company', 'category', 'description', 'details', 'timestamp', 'other'];
    return Array.from(allKeys).sort((a, b) => {
      const idxA = preferredOrder.indexOf(a);
      const idxB = preferredOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  };

  const headers = getHeaders();

  const handleExportCSV = () => {
    if (contacts.length === 0) return;
    
    const rows = contacts.map(c => headers.map(h => c[h] || ''));

    const csvContent = [
      headers.map(h => h.charAt(0).toUpperCase() + h.slice(1).replace('_', ' ')).join(','),
      ...rows.map(r => r.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `VisiCapture_Export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportXLSX = () => {
    if (contacts.length === 0) return;

    // Prepare data: filter keys based on headers order
    const dataToExport = contacts.map(contact => {
      const filtered: Record<string, any> = {};
      headers.forEach(header => {
        const readableHeader = header.charAt(0).toUpperCase() + header.slice(1).replace('_', ' ');
        filtered[readableHeader] = contact[header] || '';
      });
      return filtered;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extracted Contacts");
    
    XLSX.writeFile(workbook, `VisiCapture_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const startEditing = (idx: number) => {
    setEditingIdx(idx);
    setEditValues({ ...contacts[idx] });
  };

  const saveEdit = () => {
    if (editingIdx !== null && editValues) {
      const newContacts = [...contacts];
      newContacts[editingIdx] = editValues;
      onUpdate(newContacts);
      setEditingIdx(null);
      setEditValues(null);
    }
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditValues(null);
  };

  const deleteRow = (idx: number) => {
    if (confirm('Are you sure you want to remove this record?')) {
      const newContacts = contacts.filter((_, i) => i !== idx);
      onUpdate(newContacts);
    }
  };

  return (
    <div className="mt-8 bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl overflow-hidden">
      <div className="px-4 py-5 sm:px-6 flex flex-col sm:row justify-between items-start sm:items-center border-b border-gray-200 gap-4">
        <div className="flex-1">
          <h3 className="text-base font-semibold leading-6 text-gray-900">Extracted Intelligence</h3>
          <p className="mt-1 text-sm text-gray-500">Multimodal vision results. You can manually correct any AI observations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleExportCSV}
            disabled={contacts.length === 0}
            className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <svg className="-ml-0.5 mr-1.5 h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            CSV
          </button>
          <button
            onClick={handleExportXLSX}
            disabled={contacts.length === 0}
            className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <svg className="-ml-0.5 mr-1.5 h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Excel (XLSX)
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              {headers.map(header => (
                <th key={header} scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  {header.charAt(0).toUpperCase() + header.slice(1).replace('_', ' ')}
                </th>
              ))}
              <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6 text-right text-sm font-semibold text-gray-900">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={headers.length + 1} className="py-12 text-center text-sm text-gray-500">
                  <div className="flex flex-col items-center">
                    <svg className="h-12 w-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    <span>Waiting for video processing results...</span>
                  </div>
                </td>
              </tr>
            ) : (
              contacts.map((contact, idx) => (
                <tr key={idx} className={`${editingIdx === idx ? 'bg-indigo-50' : 'hover:bg-gray-50'} transition-colors`}>
                  {headers.map(header => (
                    <td key={header} className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {editingIdx === idx ? (
                        <input 
                          className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm p-1 w-full"
                          value={editValues?.[header] || ''}
                          onChange={(e) => setEditValues({ ...editValues!, [header]: e.target.value })}
                        />
                      ) : (contact[header] || '-')}
                    </td>
                  ))}
                  <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                    {editingIdx === idx ? (
                      <div className="flex justify-end space-x-2">
                        <button onClick={saveEdit} className="text-indigo-600 hover:text-indigo-900">Save</button>
                        <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex justify-end space-x-3">
                        <button onClick={() => startEditing(idx)} className="text-indigo-600 hover:text-indigo-900">Edit</button>
                        <button onClick={() => deleteRow(idx)} className="text-red-600 hover:text-red-900">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;
