import React, { useState } from 'react';
import { updateStoredProfile, AllergyItem } from '../lib/userSettings';
import { useAuth } from '../contexts/AuthContext';
import { 
  subscribeToAllergiesCatalog, 
  addAllergyToCatalogInFirestore,
  DEFAULT_SYSTEM_ALLERGENS 
} from '../lib/firebase';

interface SignUpProps {
  onNavigate: (screen: 'login' | 'main' | 'responder') => void;
}

type AccountType = 'citizen' | 'responder';

// Common pre-defined allergens
const COMMON_ALLERGENS = [
  'Penicillin / Amoxicillin',
  'Sulfa Drugs',
  'Aspirin / NSAIDs',
  'Peanuts & Tree Nuts',
  'Shellfish & Seafood',
  'Eggs',
  'Latex',
  'Insect Stings (Bee/Wasp)',
  'Iodine / Contrast Dye',
  'Opioids (Morphine/Codeine)'
];

const BLOOD_TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'Unknown'];

const REACTION_SUGGESTIONS = [
  'Anaphylaxis / Airway closure',
  'Hives & Severe Itching',
  'Facial / Lip Swelling',
  'Shortness of Breath',
  'Dizziness / Blood pressure drop',
  'Nausea & Vomiting'
];

const RESPONDER_AGENCIES = [
  { 
    code: 'BFP', 
    name: 'Fire (Bureau of Fire Protection - BFP)', 
    category: 'fire',
    badgePrefix: 'BFP-FIRE',
    unitPlaceholder: 'e.g. Fire Engine 01, Ladder Truck 02, or Rescue Van',
    icon: '🚒', 
    desc: 'Fire suppression, search & rescue, and hazardous materials response' 
  },
  { 
    code: 'CDRRMO', 
    name: 'Paramedics (CDRRMO / EMS Ambulance)', 
    category: 'paramedics',
    badgePrefix: 'EMS-EMT',
    unitPlaceholder: 'e.g. Ambulance Unit 04, Medic Van 01, or EMS 03',
    icon: '🚑', 
    desc: 'Emergency medical response, patient triage & ambulance transport' 
  },
  { 
    code: 'PNP', 
    name: 'PNP (Philippine National Police)', 
    category: 'pnp',
    badgePrefix: 'PNP-PATROL',
    unitPlaceholder: 'e.g. Mobile Patrol 07, Cruiser 12, or Tactical Unit',
    icon: '🚓', 
    desc: 'Law enforcement, scene security, traffic investigation & rapid response' 
  }
];

const ROLES_BY_AGENCY: Record<string, string[]> = {
  BFP: [
    'Firefighter / Search & Rescue Operative',
    'Fire Truck Commander / Apparatus Operator',
    'Hazmat & Technical Rescue Specialist',
    'Emergency Incident Commander'
  ],
  CDRRMO: [
    'ALS Paramedic / Emergency Medical Technician (EMT)',
    'BLS First Responder / Field Medic',
    'Ambulance Driver & Field Paramedic',
    'Triage & Dispatch Officer'
  ],
  PNP: [
    'Police Patrol Officer / Traffic Investigator',
    'Scene Security & Tactical Officer',
    'Law Enforcement Officer / Field Patrol',
    'Police Substation Commander'
  ]
};

export default function SignUp({ onNavigate }: SignUpProps) {
  const { register } = useAuth();

  // Navigation Step
  // For Citizen: 1: role, 2: name, 3: credentials, 4: medical, 5: allergies, 6: contact & confirm
  // For Responder: 1: role, 2: name, 3: credentials, 4: agency & role, 5: station & unit, 6: confirm
  const [step, setStep] = useState<number>(1);
  const [accountType, setAccountType] = useState<AccountType>('citizen');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2: Name
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [callSign, setCallSign] = useState('');

  // Step 3: Credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Citizen Step 4: Medical Profile
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [heightInput, setHeightInput] = useState('');

  // Citizen Step 5: Allergies
  const [selectedAllergies, setSelectedAllergies] = useState<AllergyItem[]>([]);
  const [noAllergies, setNoAllergies] = useState(false);
  
  // Custom allergy modal / input state
  const [customAllergen, setCustomAllergen] = useState('');
  const [customReaction, setCustomReaction] = useState('');
  const [customSeverity, setCustomSeverity] = useState<'Mild' | 'Moderate' | 'Severe'>('Moderate');
  const [showCustomModal, setShowCustomModal] = useState(false);

  // Live Allergies Catalog loaded from Firebase Firestore
  const [allergensList, setAllergensList] = useState<string[]>(DEFAULT_SYSTEM_ALLERGENS);
  const [allergenSearchQuery, setAllergenSearchQuery] = useState('');
  const [allergenCategory, setAllergenCategory] = useState<'All' | 'Meds' | 'Food' | 'Environmental'>('All');

  // Subscribe to live Firebase allergies_catalog collection
  React.useEffect(() => {
    const unsub = subscribeToAllergiesCatalog((list) => {
      if (list && list.length > 0) {
        setAllergensList(list);
      }
    });
    return () => unsub();
  }, []);

  const isMedicationAllergen = (name: string) => {
    const meds = ['penicillin', 'amoxicillin', 'cephalosporin', 'sulfa', 'aspirin', 'nsaid', 'ibuprofen', 'opioid', 'codeine', 'morphine', 'iodine', 'contrast', 'anesthetic', 'lidocaine', 'propofol', 'fluoroquinolone', 'ciprofloxacin', 'macrolide', 'azithromycin', 'tetracycline', 'doxycycline', 'vancomycin', 'ace inhibitor', 'lisinopril', 'anticonvulsant', 'insulin', 'vaccine', 'muscle relaxant', 'chemotherapy', 'statin'];
    return meds.some(m => name.toLowerCase().includes(m));
  };

  const isFoodAllergen = (name: string) => {
    const foods = ['peanut', 'nut', 'shellfish', 'shrimp', 'fish', 'milk', 'dairy', 'lactose', 'egg', 'wheat', 'gluten', 'soy', 'sesame', 'mustard', 'celery', 'sulfite', 'corn', 'berry', 'strawberry', 'citrus', 'kiwi', 'banana', 'avocado', 'tomato', 'garlic', 'onion', 'msg', 'tartrazine', 'meat', 'alpha-gal'];
    return foods.some(f => name.toLowerCase().includes(f));
  };

  const isEnvironmentalAllergen = (name: string) => {
    const env = ['latex', 'bee', 'wasp', 'ant', 'hornet', 'dander', 'cat', 'dog', 'horse', 'dust', 'mold', 'pollen', 'grass', 'tree', 'weed', 'cockroach', 'nickel', 'metal', 'poison', 'fragrance', 'perfume', 'sunlight', 'cold'];
    return env.some(e => name.toLowerCase().includes(e));
  };

  const filteredAllergensList = allergensList.filter(name => {
    const matchesSearch = name.toLowerCase().includes(allergenSearchQuery.toLowerCase().trim());
    if (!matchesSearch) return false;
    if (allergenCategory === 'Meds') return isMedicationAllergen(name);
    if (allergenCategory === 'Food') return isFoodAllergen(name);
    if (allergenCategory === 'Environmental') return isEnvironmentalAllergen(name);
    return true;
  });

  // Active allergen being edited for reaction
  const [activeEditingAllergen, setActiveEditingAllergen] = useState<string | null>(null);
  const [tempReaction, setTempReaction] = useState('');
  const [tempSeverity, setTempSeverity] = useState<'Mild' | 'Moderate' | 'Severe'>('Moderate');

  // Citizen Step 6: Emergency Contact
  const [contactName, setContactName] = useState('');
  const [contactRelation, setContactRelation] = useState('Parent / Guardian');
  const [contactPhone, setContactPhone] = useState('');

  // Responder Step 4: Agency & Role (3 types: Fire, Paramedics, PNP)
  const [agency, setAgency] = useState<'BFP' | 'CDRRMO' | 'PNP'>('CDRRMO');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [responderRole, setResponderRole] = useState(ROLES_BY_AGENCY['CDRRMO'][0]);

  // Responder Step 5: Station & Unit (station is now a flexible text input)
  const [assignedStation, setAssignedStation] = useState('');
  const [vehicleUnit, setVehicleUnit] = useState('');
  const [dutyShift, setDutyShift] = useState<'Day Shift (08:00 - 20:00)' | 'Night Shift (20:00 - 08:00)' | '24-Hour Duty'>('Day Shift (08:00 - 20:00)');

  const handleSelectAgency = (agCode: 'BFP' | 'CDRRMO' | 'PNP') => {
    setAgency(agCode);
    const availableRoles = ROLES_BY_AGENCY[agCode] || [];
    if (availableRoles.length > 0) {
      setResponderRole(availableRoles[0]);
    }
  };

  const totalSteps = 6;

  // Weight handler: auto-appends ' kg' when typing digits
  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setWeightInput('');
    } else {
      const num = parseInt(rawDigits, 10);
      if (num <= 500) {
        setWeightInput(`${num} kg`);
      }
    }
  };

  // Height handler: auto-appends ' cm' when typing digits
  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawDigits = e.target.value.replace(/\D/g, '');
    if (!rawDigits) {
      setHeightInput('');
    } else {
      const num = parseInt(rawDigits, 10);
      if (num <= 300) {
        setHeightInput(`${num} cm`);
      }
    }
  };

  // Helper to extract integer value
  const parseInteger = (str: string, fallback: number) => {
    const digits = str.replace(/\D/g, '');
    const num = parseInt(digits, 10);
    return isNaN(num) ? fallback : num;
  };

  // Calculate age from DOB
  const getAge = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const bDate = new Date(dateStr);
      const diff = Date.now() - bDate.getTime();
      const ageDate = new Date(diff);
      const age = Math.abs(ageDate.getUTCFullYear() - 1970);
      return !isNaN(age) ? `${age} years old` : '';
    } catch {
      return '';
    }
  };

  // Back button navigation
  const handleBack = () => {
    setError(null);
    if (step > 1) {
      setStep(step - 1);
    } else {
      onNavigate('login');
    }
  };

  // Step 1 Validation -> Step 2
  const handleRoleSelect = (role: AccountType) => {
    setAccountType(role);
    setError(null);
    setStep(2);
  };

  // Step 2 Validation -> Step 3
  const handleNameNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Please enter your full legal name.');
      return;
    }
    setError(null);
    setStep(3);
  };

  // Step 3 Validation -> Step 4
  const handleCredentialsNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please provide a valid email address.');
      return;
    }
    if (!password) {
      setError('Please choose a password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must contain at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please verify.');
      return;
    }
    setError(null);
    setStep(4);
  };

  // Citizen Step 4 Validation -> Step 5
  const handleMedicalNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dob) {
      setError('Please select your date of birth.');
      return;
    }
    setError(null);
    setStep(5);
  };

  // Citizen Step 5: Allergy selection toggle
  const toggleAllergen = (allergenName: string) => {
    if (noAllergies) setNoAllergies(false);

    const exists = selectedAllergies.find(a => a.allergen === allergenName);
    if (exists) {
      setSelectedAllergies(prev => prev.filter(a => a.allergen !== allergenName));
      if (activeEditingAllergen === allergenName) {
        setActiveEditingAllergen(null);
      }
    } else {
      const newItem: AllergyItem = {
        id: `all-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        allergen: allergenName,
        reaction: 'Severe Reaction / Monitored',
        severity: 'Moderate'
      };
      setSelectedAllergies(prev => [...prev, newItem]);
      setActiveEditingAllergen(allergenName);
      setTempReaction(newItem.reaction);
      setTempSeverity(newItem.severity);
    }
  };

  const handleSaveActiveAllergen = () => {
    if (!activeEditingAllergen) return;
    setSelectedAllergies(prev => prev.map(a => {
      if (a.allergen === activeEditingAllergen) {
        return {
          ...a,
          reaction: tempReaction.trim() || 'Monitored reaction',
          severity: tempSeverity
        };
      }
      return a;
    }));
    setActiveEditingAllergen(null);
  };

  const handleAddCustomAllergy = () => {
    if (!customAllergen.trim()) return;
    const allergenName = customAllergen.trim();
    const newItem: AllergyItem = {
      id: `all-custom-${Date.now()}`,
      allergen: allergenName,
      reaction: customReaction.trim() || 'Monitored allergic response',
      severity: customSeverity
    };
    setSelectedAllergies(prev => [...prev, newItem]);
    
    // Save to Firebase allergies_catalog collection
    addAllergyToCatalogInFirestore(allergenName);

    setCustomAllergen('');
    setCustomReaction('');
    setShowCustomModal(false);
  };

  const handleRemoveAllergy = (id: string) => {
    setSelectedAllergies(prev => prev.filter(a => a.id !== id));
  };

  const handleNoAllergiesToggle = () => {
    if (!noAllergies) {
      setNoAllergies(true);
      setSelectedAllergies([]);
      setActiveEditingAllergen(null);
    } else {
      setNoAllergies(false);
    }
  };

  // Citizen Step 5 -> Step 6
  const handleAllergiesNext = () => {
    setError(null);
    setStep(6);
  };

  // Responder Step 4 -> Step 5
  const handleResponderAgencyNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!badgeNumber.trim()) {
      setError('Please provide your Agency Badge / Personnel ID number.');
      return;
    }
    setError(null);
    setStep(5);
  };

  // Responder Step 5 -> Step 6
  const handleResponderStationNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleUnit.trim()) {
      setError('Please designate your assigned vehicle / unit code.');
      return;
    }
    setError(null);
    setStep(6);
  };

  // Final Submission for both Citizen & Responder
  const handleFinalSubmit = async () => {
    setLoading(true);
    setError(null);

    const nameParts = fullName.trim().split(' ');
    const calculatedDisplayName = displayName.trim() || nameParts[0] || (accountType === 'citizen' ? 'Citizen' : 'Responder');

    if (accountType === 'citizen') {
      const finalAllergies = noAllergies ? [] : selectedAllergies;

      const profilePayload = {
        fullName: fullName.trim(),
        displayName: calculatedDisplayName,
        email: email.trim(),
        bloodType,
        birthdate: dob,
        heightCm: parseInteger(heightInput, 175),
        weightKg: parseInteger(weightInput, 70),
        allergies: finalAllergies,
        role: 'citizen' as const,
        emergencyContact: contactName.trim() ? {
          name: contactName.trim(),
          relation: contactRelation.trim() || 'Emergency Contact',
          phone: contactPhone.trim()
        } : {
          name: '',
          relation: '',
          phone: ''
        },
        emergencyCircle: contactName.trim() ? [
          {
            id: `c-prim-${Date.now()}`,
            name: contactName.trim(),
            phone: contactPhone.trim(),
            relation: contactRelation.trim() || 'Emergency Contact',
            isPrimary: true
          }
        ] : [],
        avatarUrl: ''
      };

      // Wipe any leftover data from previous accounts before saving this new user's state
      try {
        localStorage.removeItem('serd_app_settings');
      } catch {}

      // Update local profile state
      updateStoredProfile(profilePayload);

      // Register with Firebase
      const res = await register(email, password, profilePayload);
      setLoading(false);

      if (res.success) {
        onNavigate('main');
      } else {
        setError(res.error || 'Registration failed. Please check your credentials.');
      }
    } else {
      // Responder Registration
      const responderProfile = {
        fullName: fullName.trim(),
        displayName: calculatedDisplayName,
        email: email.trim(),
        role: 'responder' as const,
        agency,
        badgeNumber: badgeNumber.trim(),
        responderRole,
        station: assignedStation.trim() || 'Regional Base / Field Unit',
        vehicleUnit: vehicleUnit.trim(),
        callSign: callSign.trim() || calculatedDisplayName
      };

      updateStoredProfile({
        fullName: responderProfile.fullName,
        displayName: responderProfile.displayName,
        email: responderProfile.email
      });

      const res = await register(email, password, responderProfile);
      setLoading(false);

      if (res.success) {
        onNavigate('responder');
      } else {
        setError(res.error || 'Responder registration failed.');
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-white font-sans overflow-hidden select-none">
      
      {/* Top Header & Breadcrumb Progress */}
      <div className="pt-6 px-6 pb-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <button 
            type="button"
            onClick={handleBack}
            className="px-2.5 py-1 text-gray-700 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer text-xs font-bold"
            aria-label="Back"
          >
            &larr; Back
          </button>
          
          <div className="text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Step {step} of {totalSteps}
            </span>
          </div>

          <button 
            type="button"
            onClick={() => onNavigate('login')}
            className="text-xs font-semibold text-gray-500 hover:text-[#B41A46] transition-colors cursor-pointer"
          >
            Log In
          </button>
        </div>

        {/* Minimal Progress Bar */}
        <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
          <div 
            className="h-full bg-[#B41A46] transition-all duration-300 ease-out"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Main Form Body (Scrollable) */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-md mx-auto w-full">
        
        {/* Error Alert Box */}
        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 flex items-start gap-3 animate-[fade-in_0.2s_ease-out]">
            <span className="font-mono font-bold text-xs text-rose-600 shrink-0 mt-0.5">[!]</span>
            <div className="flex-1 leading-relaxed font-medium">
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 1: ROLE SELECTOR                                                     */}
        {/* ========================================================================= */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <span className="inline-block px-3 py-1 bg-rose-50 text-[#B41A46] text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Account Setup
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Choose Profile Type</h1>
              <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">
                Select your operational role in the SERD emergency dispatch network.
              </p>
            </div>

            <div className="space-y-4">
              {/* Option A: Citizen */}
              <button
                type="button"
                onClick={() => handleRoleSelect('citizen')}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden group ${
                  accountType === 'citizen'
                    ? 'border-[#B41A46] bg-rose-50/30 shadow-xs'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#B41A46]/10 text-[#B41A46] flex items-center justify-center shrink-0 font-bold text-xs tracking-wider">
                    CITIZEN
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-base text-gray-900">Citizen / Resident</h3>
                      <span className="w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center group-hover:border-[#B41A46]">
                        {accountType === 'citizen' && <span className="w-2.5 h-2.5 rounded-full bg-[#B41A46]"></span>}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Instant 911 SOS button, automated emergency CAD medical pass transmission, and family safety circle check-ins.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md text-[10px] font-semibold">1-Tap 911 SOS</span>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md text-[10px] font-semibold">Emergency Medical Pass</span>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md text-[10px] font-semibold">Live Responder Route</span>
                    </div>
                  </div>
                </div>
              </button>

              {/* Option B: Responder */}
              <button
                type="button"
                onClick={() => handleRoleSelect('responder')}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden group ${
                  accountType === 'responder'
                    ? 'border-[#B41A46] bg-rose-50/30 shadow-xs'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 font-bold text-xs tracking-wider">
                    UNIT
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-base text-gray-900">First Responder / Agency</h3>
                      <span className="w-5 h-5 rounded-full border border-gray-300 flex items-center justify-center group-hover:border-blue-700">
                        {accountType === 'responder' && <span className="w-2.5 h-2.5 rounded-full bg-blue-700"></span>}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      For certified paramedics, BFP firefighters, police officers, and disaster rescue crews responding to field incidents.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-md text-[10px] font-semibold">CAD Field Dispatch</span>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-md text-[10px] font-semibold">Patient Triage Access</span>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-md text-[10px] font-semibold">Dijkstra Navigation</span>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full mt-6 py-4 bg-[#B41A46] text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(180,26,70,0.25)] hover:bg-[#9a143a] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Continue with {accountType === 'citizen' ? 'Citizen' : 'Responder'} &rarr;</span>
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PAGE 2: NAME                                                              */}
        {/* ========================================================================= */}
        {step === 2 && (
          <form onSubmit={handleNameNext} className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Identity
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">What's your name?</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                {accountType === 'citizen' 
                  ? 'Attending paramedics and emergency responders need your real legal name to match medical records during emergency calls.'
                  : 'Enter your legal name and tactical radio call-sign for incident command coordination.'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Full Legal Name <span className="text-[#B41A46]">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Juan dela Cruz"
                  className="w-full px-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-medium transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Preferred / First Name (Optional)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Juan"
                  className="w-full px-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-medium transition-all"
                />
                <span className="text-[11px] text-gray-400 mt-1 block">Used in greetings and quick dispatch notifications.</span>
              </div>

              {accountType === 'responder' && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                    Tactical Call Sign / Radio Alias
                  </label>
                  <input
                    type="text"
                    value={callSign}
                    onChange={(e) => setCallSign(e.target.value)}
                    placeholder="e.g. Medic-4 or Sierra-1"
                    className="w-full px-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-100 text-gray-900 text-sm font-medium transition-all font-mono"
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              className="w-full mt-8 py-4 bg-[#B41A46] text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(180,26,70,0.25)] hover:bg-[#9a143a] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Next: Account Credentials &rarr;</span>
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* PAGE 3: EMAIL AND PASSWORD                                                */}
        {/* ========================================================================= */}
        {step === 3 && (
          <form onSubmit={handleCredentialsNext} className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Credentials
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Email & Password</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Set up secure login credentials to protect your emergency profile.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Email Address <span className="text-[#B41A46]">*</span>
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-medium transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Password <span className="text-[#B41A46]">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full px-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-medium transition-all pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 px-1 py-0.5 text-xs font-bold cursor-pointer"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Confirm Password <span className="text-[#B41A46]">*</span>
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-type your password"
                  className="w-full px-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-medium transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-8 py-4 bg-[#B41A46] text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(180,26,70,0.25)] hover:bg-[#9a143a] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Next: {accountType === 'citizen' ? 'Medical Profile' : 'Agency Details'} &rarr;</span>
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* CITIZEN PAGE 4: MEDICAL PROFILE (DOB, BLOOD TYPE, WEIGHT, HEIGHT)         */}
        {/* ========================================================================= */}
        {step === 4 && accountType === 'citizen' && (
          <form onSubmit={handleMedicalNext} className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-rose-50 text-[#B41A46] text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Emergency Vitals
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Medical Profile</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Vital medical data dispatched directly to emergency responders for rapid triage.
              </p>
            </div>

            <div className="space-y-5">
              {/* Date of Birth Selector with clean app styling */}
              <div className="bg-gray-50/70 border border-gray-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Date of Birth
                  </label>
                  {getAge(dob) && (
                    <span className="text-[11px] font-bold text-[#B41A46] bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-100">
                      {getAge(dob)}
                    </span>
                  )}
                </div>
                
                <input
                  type="date"
                  required
                  value={dob}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[#B41A46] text-gray-900 text-sm font-semibold cursor-pointer shadow-2xs"
                />
                <span className="text-[11px] text-gray-400 mt-2 block">
                  Used by medics to calculate pediatric vs adult medication dosages.
                </span>
              </div>

              {/* Blood Type Grid Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Blood Type <span className="text-[#B41A46]">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {BLOOD_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setBloodType(type)}
                      className={`py-3 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                        bloodType === type
                          ? 'bg-[#B41A46] text-white border-[#B41A46] shadow-sm scale-[1.02]'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weight & Height with auto-suffix */}
              <div className="grid grid-cols-2 gap-3">
                {/* Weight Input (Integer + auto kg) */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Weight
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={weightInput}
                      onChange={handleWeightChange}
                      placeholder="e.g. 70 kg"
                      className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-semibold transition-all"
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 block">Auto-appends "kg"</span>
                </div>

                {/* Height Input (Integer + auto cm) */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Height
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={heightInput}
                      onChange={handleHeightChange}
                      placeholder="e.g. 175 cm"
                      className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[#B41A46] focus:ring-4 focus:ring-[#B41A46]/10 text-gray-900 text-sm font-semibold transition-all"
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 block">Auto-appends "cm"</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-6 py-4 bg-[#B41A46] text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(180,26,70,0.25)] hover:bg-[#9a143a] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Next: Allergies & Reactions &rarr;</span>
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* CITIZEN PAGE 5: ALLERGIES SELECTOR & CUSTOM CREATOR                       */}
        {/* ========================================================================= */}
        {step === 5 && accountType === 'citizen' && (
          <div className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-rose-50 text-[#B41A46] text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Contraindications
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Known Allergies</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Select allergies from the list or add custom ones. Specify reactions to protect your care in emergencies.
              </p>
            </div>

            {/* No Allergies Quick Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 bg-gray-50/50">
              <span className="text-xs font-semibold text-gray-800">
                I have no known drug or food allergies
              </span>
              <button
                type="button"
                onClick={handleNoAllergiesToggle}
                className={`px-3 py-1 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                  noAllergies 
                    ? 'bg-[#B41A46] border-[#B41A46] text-white' 
                    : 'bg-white border-gray-300 text-gray-500'
                }`}
              >
                {noAllergies ? 'Yes (None)' : 'No'}
              </button>
            </div>

            {!noAllergies && (
              <div className="space-y-4">
                {/* Currently Added Allergies List */}
                {selectedAllergies.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                      Selected Allergies ({selectedAllergies.length})
                    </label>
                    <div className="space-y-2">
                      {selectedAllergies.map((item) => (
                        <div 
                          key={item.id}
                          className="p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-between shadow-2xs"
                        >
                          <div className="flex-1 pr-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-gray-900">{item.allergen}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${
                                item.severity === 'Severe' 
                                   ? 'bg-rose-100 text-rose-700' 
                                   : item.severity === 'Moderate'
                                   ? 'bg-amber-100 text-amber-700'
                                   : 'bg-gray-100 text-gray-600'
                              }`}>
                                {item.severity}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              Reaction: <span className="font-medium text-gray-700">{item.reaction}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveEditingAllergen(item.allergen);
                                setTempReaction(item.reaction);
                                setTempSeverity(item.severity);
                              }}
                              className="text-[11px] font-semibold text-[#B41A46] hover:underline px-1.5 py-1"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAllergy(item.id)}
                              className="px-2 py-1 text-xs font-semibold text-gray-400 hover:text-rose-600 rounded-md transition-colors"
                              aria-label="Remove allergy"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Reaction & Severity Editor for Active Allergen */}
                {activeEditingAllergen && (
                  <div className="p-4 bg-rose-50/50 border border-rose-200 rounded-2xl space-y-3 animate-[fade-in_0.2s_ease-out]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#B41A46]">
                        Reaction Details for: {activeEditingAllergen}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveEditingAllergen(null)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Describe What Happens (Reaction):
                      </label>
                      <input
                        type="text"
                        value={tempReaction}
                        onChange={(e) => setTempReaction(e.target.value)}
                        placeholder="e.g. Anaphylaxis, Rash, Swelling"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#B41A46]"
                      />
                      
                      {/* Reaction quick tags */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {REACTION_SUGGESTIONS.map((rec) => (
                          <button
                            key={rec}
                            type="button"
                            onClick={() => setTempReaction(rec)}
                            className="text-[10px] px-2 py-0.5 bg-white border border-gray-200 hover:border-[#B41A46] rounded-md text-gray-600 transition-colors"
                          >
                            {rec}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Severity Level:
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['Mild', 'Moderate', 'Severe'] as const).map((sev) => (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setTempSeverity(sev)}
                            className={`py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                              tempSeverity === sev
                                ? sev === 'Severe' 
                                  ? 'bg-rose-600 text-white border-rose-600' 
                                  : 'bg-[#B41A46] text-white border-[#B41A46]'
                                : 'bg-white text-gray-700 border-gray-200'
                            }`}
                          >
                            {sev}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveActiveAllergen}
                      className="w-full py-2 bg-[#B41A46] text-white text-xs font-semibold rounded-xl hover:bg-[#9a143a] transition-colors"
                    >
                      Save Reaction Info
                    </button>
                  </div>
                )}

                {/* Common Allergen Selector Grid from Firebase Catalog */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Select Allergens:
                    </label>
                    <span className="text-[10px] font-semibold text-[#B41A46] bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#B41A46]"></span>
                      <span>Medical Catalog ({allergensList.length})</span>
                    </span>
                  </div>

                  {/* Search Bar */}
                  <div className="relative">
                    <input
                      type="text"
                      value={allergenSearchQuery}
                      onChange={(e) => setAllergenSearchQuery(e.target.value)}
                      placeholder="Search allergies, drugs, foods..."
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#B41A46]"
                    />
                    {allergenSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setAllergenSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 text-xs font-bold"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Category Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                    {(['All', 'Meds', 'Food', 'Environmental'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setAllergenCategory(tab)}
                        className={`px-2.5 py-0.5 rounded-full font-semibold transition-all whitespace-nowrap text-[11px] cursor-pointer ${
                          allergenCategory === tab
                            ? 'bg-[#B41A46] text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {tab === 'Meds' ? 'Meds & Drugs' : tab === 'Food' ? 'Foods' : tab === 'Environmental' ? 'Environment' : 'All'}
                      </button>
                    ))}
                  </div>

                  {/* Allergens Grid */}
                  <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {filteredAllergensList.length === 0 ? (
                      <div className="col-span-2 py-4 text-center text-xs text-gray-400">
                        No allergen found matching "{allergenSearchQuery}". Use "Add Custom Allergy" below.
                      </div>
                    ) : (
                      filteredAllergensList.map((allergen) => {
                        const isSelected = selectedAllergies.some(a => a.allergen === allergen);
                        return (
                          <button
                            key={allergen}
                            type="button"
                            onClick={() => toggleAllergen(allergen)}
                            className={`p-2 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
                              isSelected
                                ? 'bg-rose-50 border-[#B41A46] text-[#B41A46]'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <span className="truncate pr-1 text-[11px]">{allergen}</span>
                            <span className="text-[10px] font-bold">
                              {isSelected ? '✓' : '+'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Custom Allergen Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomModal(true)}
                    className="w-full py-3 px-4 rounded-xl border border-dashed border-gray-300 hover:border-[#B41A46] bg-gray-50/50 hover:bg-rose-50/20 text-gray-700 hover:text-[#B41A46] text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>+ Add Custom Allergy</span>
                  </button>
                </div>
              </div>
            )}

            {/* Custom Allergy Modal Overlay */}
            {showCustomModal && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-sm p-5 space-y-4 animate-[fade-in_0.15s_ease-out]">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="font-bold text-sm text-gray-900">Add Custom Allergy</h3>
                    <button 
                      type="button"
                      onClick={() => setShowCustomModal(false)}
                      className="text-gray-400 hover:text-gray-600 text-xs font-bold"
                    >
                      Close
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Allergen / Substance Name <span className="text-[#B41A46]">*</span>
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={customAllergen}
                      onChange={(e) => setCustomAllergen(e.target.value)}
                      placeholder="e.g. Ciprofloxacin or Strawberries"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:bg-white focus:border-[#B41A46]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Reaction Description
                    </label>
                    <input
                      type="text"
                      value={customReaction}
                      onChange={(e) => setCustomReaction(e.target.value)}
                      placeholder="e.g. Swelling, Throat Tightening"
                      className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:bg-white focus:border-[#B41A46]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Severity
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['Mild', 'Moderate', 'Severe'] as const).map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => setCustomSeverity(sev)}
                          className={`py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                            customSeverity === sev
                              ? 'bg-[#B41A46] text-white border-[#B41A46]'
                              : 'bg-white text-gray-700 border-gray-200'
                          }`}
                        >
                          {sev}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCustomModal(false)}
                      className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!customAllergen.trim()}
                      onClick={handleAddCustomAllergy}
                      className="flex-1 py-2.5 bg-[#B41A46] text-white text-xs font-bold rounded-xl hover:bg-[#9a143a] transition-colors disabled:opacity-50"
                    >
                      Add Allergy
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleAllergiesNext}
              className="w-full mt-6 py-4 bg-[#B41A46] text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(180,26,70,0.25)] hover:bg-[#9a143a] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Next: Emergency Contact & Review &rarr;</span>
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* CITIZEN PAGE 6: EMERGENCY CONTACT & REVIEW CONFIRMATION                   */}
        {/* ========================================================================= */}
        {step === 6 && accountType === 'citizen' && (
          <div className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-rose-50 text-[#B41A46] text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Emergency Contact
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Final Step: Contact & Review</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Add an emergency contact who will be alerted during SOS calls.
              </p>
            </div>

            {/* Emergency Contact Inputs */}
            <div className="bg-gray-50/70 border border-gray-200 rounded-2xl p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Contact Full Name
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="e.g. Maria dela Cruz"
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#B41A46]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Relationship
                  </label>
                  <input
                    type="text"
                    value={contactRelation}
                    onChange={(e) => setContactRelation(e.target.value)}
                    placeholder="e.g. Spouse"
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#B41A46]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+63 917 555 0144"
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#B41A46] font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Summary Review Card */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-2xs">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Account Summary</h3>
              
              <div className="text-xs space-y-1.5 text-gray-600">
                <div className="flex justify-between">
                  <span className="text-gray-400">Name:</span>
                  <span className="font-semibold text-gray-900">{fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Email:</span>
                  <span className="font-semibold text-gray-900">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Blood Type & Age:</span>
                  <span className="font-semibold text-[#B41A46]">{bloodType} • {getAge(dob)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Weight & Height:</span>
                  <span className="font-semibold text-gray-900">{weightInput} • {heightInput}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Allergies:</span>
                  <span className="font-semibold text-gray-900">
                    {noAllergies ? 'None Reported' : `${selectedAllergies.length} registered`}
                  </span>
                </div>
              </div>
            </div>

            {/* Final Submit Button */}
            <button
              type="button"
              disabled={loading}
              onClick={handleFinalSubmit}
              className="w-full py-4 bg-[#B41A46] text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(180,26,70,0.25)] hover:bg-[#9a143a] transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>COMPLETE SIGN UP</span>
              )}
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* RESPONDER PAGE 4: AGENCY & ROLE (3 TYPES: FIRE, PARAMEDICS, PNP)          */}
        {/* ========================================================================= */}
        {step === 4 && accountType === 'responder' && (
          <form onSubmit={handleResponderAgencyNext} className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Responder Branch
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Select Responder Branch</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Connect your field unit to the CAD emergency network (matching the citizen map).
              </p>
            </div>

            <div className="space-y-4">
              {/* Agency Selector - 3 Types Only */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Emergency Service Type <span className="text-blue-700">*</span>
                </label>
                <div className="space-y-2.5">
                  {RESPONDER_AGENCIES.map((ag) => {
                    const isSelected = agency === ag.code;
                    return (
                      <button
                        key={ag.code}
                        type="button"
                        onClick={() => handleSelectAgency(ag.code as any)}
                        className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                          isSelected
                            ? 'border-blue-700 bg-blue-50/50 shadow-sm ring-1 ring-blue-700/20'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/60'
                        }`}
                      >
                        <span className="text-2xl shrink-0 mt-0.5">{ag.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-bold text-xs sm:text-sm text-gray-900">{ag.name}</h4>
                            {isSelected && <span className="text-xs font-bold text-blue-700">✓ Selected</span>}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{ag.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Badge Number */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Badge / Personnel ID Number <span className="text-blue-700">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={badgeNumber}
                  onChange={(e) => setBadgeNumber(e.target.value)}
                  placeholder={
                    agency === 'BFP' ? 'e.g. BFP-FIRE-402' : agency === 'PNP' ? 'e.g. PNP-PATROL-119' : 'e.g. CDRRMO-EMT-883'
                  }
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-700 text-gray-900 text-sm font-semibold font-mono"
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Operational Role
                </label>
                <select
                  value={responderRole}
                  onChange={(e) => setResponderRole(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-700 text-gray-900 text-sm font-semibold cursor-pointer"
                >
                  {(ROLES_BY_AGENCY[agency] || []).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-6 py-4 bg-blue-700 text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(29,78,216,0.25)] hover:bg-blue-800 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Next: Station & Vehicle Unit &rarr;</span>
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* RESPONDER PAGE 5: STATION & APPARATUS VEHICLE                             */}
        {/* ========================================================================= */}
        {step === 5 && accountType === 'responder' && (
          <form onSubmit={handleResponderStationNext} className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Operational Base
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Station & Apparatus</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Designate your base station and vehicle code for GPS routing dispatch.
              </p>
            </div>

            <div className="space-y-4">
              {/* Flexible Text Input for Station */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Assigned Station / Post Location</span>
                  <span className="text-[11px] font-normal text-gray-400">Any City / District</span>
                </label>
                <input
                  type="text"
                  value={assignedStation}
                  onChange={(e) => setAssignedStation(e.target.value)}
                  placeholder="e.g. Central Fire Station, Sub-Station 4, District Headquarters, or Outpost Name"
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-700 text-gray-900 text-sm font-medium"
                />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Type your station, precinct, outpost, or local emergency headquarters location.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Vehicle Unit Code <span className="text-blue-700">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={vehicleUnit}
                  onChange={(e) => setVehicleUnit(e.target.value)}
                  placeholder={
                    agency === 'BFP'
                      ? 'e.g. Fire Engine 01, Ladder Truck 02, or Rescue Van'
                      : agency === 'PNP'
                      ? 'e.g. Mobile Patrol 07, Cruiser 12, or Tactical Unit'
                      : 'e.g. Ambulance Unit 04, Medic Van 01, or EMS 03'
                  }
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-700 text-gray-900 text-sm font-semibold font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Active Duty Shift
                </label>
                <div className="space-y-2">
                  {(['Day Shift (08:00 - 20:00)', 'Night Shift (20:00 - 08:00)', '24-Hour Duty'] as const).map((shift) => (
                    <button
                      key={shift}
                      type="button"
                      onClick={() => setDutyShift(shift)}
                      className={`w-full text-left p-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
                        dutyShift === shift
                          ? 'border-blue-700 bg-blue-50/50 text-blue-900 font-bold'
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      <span>{shift}</span>
                      {dutyShift === shift && <span className="text-xs font-bold text-blue-700">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-6 py-4 bg-blue-700 text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(29,78,216,0.25)] hover:bg-blue-800 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Next: Review & Confirm &rarr;</span>
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* RESPONDER PAGE 6: REVIEW & CONFIRMATION                                   */}
        {/* ========================================================================= */}
        {step === 6 && accountType === 'responder' && (
          <div className="space-y-6">
            <div>
              <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-[11px] font-bold uppercase tracking-wider rounded-full mb-2">
                Verification
              </span>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Confirm Responder ID</h1>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Review your emergency field responder credentials before deployment.
              </p>
            </div>

            {/* Responder Summary Card */}
            <div className="bg-white border-2 border-blue-100 rounded-2xl p-5 space-y-3.5 shadow-xs">
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs font-mono">
                  UNIT
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900">{fullName}</h3>
                  <p className="text-xs font-mono text-blue-700 font-semibold">{callSign || 'Unit Active'} • {badgeNumber}</p>
                </div>
              </div>

              <div className="text-xs space-y-2 text-gray-600">
                <div className="flex justify-between">
                  <span className="text-gray-400">Agency:</span>
                  <span className="font-bold text-gray-900">
                    {RESPONDER_AGENCIES.find(a => a.code === agency)?.name || agency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Role:</span>
                  <span className="font-semibold text-gray-900">{responderRole}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Assigned Unit:</span>
                  <span className="font-mono font-bold text-blue-700">{vehicleUnit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Base Station / Location:</span>
                  <span className="font-semibold text-gray-900 text-right max-w-[200px] truncate">
                    {assignedStation.trim() || 'Regional Base / Field Unit'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Shift:</span>
                  <span className="font-semibold text-gray-900">{dutyShift}</span>
                </div>
              </div>
            </div>

            {/* Final Submit Button */}
            <button
              type="button"
              disabled={loading}
              onClick={handleFinalSubmit}
              className="w-full py-4 bg-blue-700 text-white font-semibold rounded-2xl shadow-[0_8px_20px_rgb(29,78,216,0.25)] hover:bg-blue-800 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Registering Responder Profile...</span>
                </>
              ) : (
                <span>COMPLETE RESPONDER REGISTRATION</span>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
