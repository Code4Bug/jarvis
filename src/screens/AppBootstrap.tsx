import React, { useState } from 'react';
import REPL from './repl.js';
import SetupWizard from './setup/SetupWizard.js';
import { BootstrapStatus, checkBootstrapStatus } from '../config/bootstrap.js';

interface AppBootstrapProps {
  initialResumeSessionId?: string;
}

export default function AppBootstrap({ initialResumeSessionId }: AppBootstrapProps) {
  const [status, setStatus] = useState<BootstrapStatus>(() => checkBootstrapStatus());

  if (status.ok) {
    return <REPL initialResumeSessionId={initialResumeSessionId} />;
  }

  return (
    <SetupWizard
      initialStatus={status}
      onCompleted={() => {
        setStatus(checkBootstrapStatus());
      }}
    />
  );
}
