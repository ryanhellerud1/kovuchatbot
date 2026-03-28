'use client';

import type { Attachment, UIMessage } from 'ai';
import cx from 'classnames';
import type React from 'react';
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
  // useState, // Already implicitly imported via other hooks if used, but good to be explicit if needed
  // useEffect, // Already imported
  // useCallback, // Already imported
  // useRef, // Already imported
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';

import { ProactiveSuggestions } from './proactive-suggestions'; // Added import
import { ArrowUpIcon, PaperclipIcon, StopIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { SuggestedActions } from './suggested-actions';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  append,
  handleSubmit,
  className,
}: {
  chatId: string;
  input: UseChatHelpers['input'];
  setInput: UseChatHelpers['setInput'];
  status: UseChatHelpers['status'];
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<UIMessage>;
  setMessages: UseChatHelpers['setMessages'];
  append: UseChatHelpers['append'];
  handleSubmit: UseChatHelpers['handleSubmit'];
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const [proactiveSuggestionsList, setProactiveSuggestionsList] = useState<string[]>([]);
  const [showProactiveSuggestions, setShowProactiveSuggestions] = useState<boolean>(false);
  const hesitationTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchProactiveSuggestions = useCallback(async () => {
    if (input.trim() === '') {
      setShowProactiveSuggestions(false);
      return;
    }

    const minimalChatHistory = messages
      .map(msg => ({
        role: msg.role,
        // Ensure content is string; adjust if your UIMessage content can be complex
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }))
      .slice(-10); // Send last 10 messages

    try {
      const response = await fetch('/api/chat/proactive-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partialQuery: input, chatHistory: minimalChatHistory }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.suggestions && data.suggestions.length > 0) {
          setProactiveSuggestionsList(data.suggestions);
          setShowProactiveSuggestions(true);
        } else {
          setShowProactiveSuggestions(false);
        }
      } else {
        console.error('Failed to fetch proactive suggestions:', response.statusText);
        setShowProactiveSuggestions(false);
      }
    } catch (error) {
      console.error('Error fetching proactive suggestions:', error);
      setShowProactiveSuggestions(false);
    }
  }, [input, messages]);

  useEffect(() => {
    if (hesitationTimerRef.current) {
      clearTimeout(hesitationTimerRef.current);
    }

    if (input.trim() === '') {
      setShowProactiveSuggestions(false);
      setProactiveSuggestionsList([]); // Clear suggestions when input is empty
      return;
    }

    hesitationTimerRef.current = setTimeout(() => {
      fetchProactiveSuggestions();
    }, 2500); // 2.5 seconds delay

    return () => {
      if (hesitationTimerRef.current) {
        clearTimeout(hesitationTimerRef.current);
      }
    };
  }, [input, fetchProactiveSuggestions]);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = '98px';
    }
  };

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    '',
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  const submitForm = useCallback(() => {
    window.history.replaceState({}, '', `/chat/${chatId}`);

    handleSubmit(undefined, {
      experimental_attachments: attachments,
    });

    setAttachments([]);
    setLocalStorageInput('');
    resetHeight();

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    attachments,
    handleSubmit,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
  ]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    // Add type parameter to help server determine upload handling
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const isKnowledgeDocument = ['.pdf', '.docx', '.txt', '.md', '.markdown'].includes(fileExtension);
    formData.append('type', isKnowledgeDocument ? 'knowledge' : 'attachment');

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      // Handle 413 (Request Entity Too Large) specifically
      if (response.status === 413) {
        const maxSize = isKnowledgeDocument ? '15MB' : '50MB';
        toast.error(`File too large for upload. Maximum size is ${maxSize}. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
        return;
      }

      if (response.ok) {
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const responseText = await response.text();
          console.error('Non-JSON response received:', responseText);
          toast.error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
          return;
        }

        const data = await response.json();
        const { url, pathname, contentType: fileContentType, size } = data;

        // Show success message for large files
        if (size && size > 4.5 * 1024 * 1024) {
          toast.success(`Large file uploaded successfully (${(size / 1024 / 1024).toFixed(1)}MB)`);
        }

        return {
          url,
          name: pathname,
          contentType: fileContentType,
        };
      }
      
      // Handle error response
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('Non-JSON error response received:', responseText);
        toast.error(`Server error: ${response.status} ${response.statusText}`);
        return;
      }
      
      const { error } = await response.json();
      toast.error(error);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload file, please try again!');
    }
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined,
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error('Error uploading files!', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments],
  );

  return (
    <div className="relative w-full flex flex-col gap-4">
      <ProactiveSuggestions
        suggestions={proactiveSuggestionsList}
        append={append}
        isVisible={showProactiveSuggestions}
        onDismiss={() => setShowProactiveSuggestions(false)}
      />
      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions append={append} chatId={chatId} />
        )}

      <input
        type="file"
        className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {(attachments.length > 0 || uploadQueue.length > 0) && (
        <div
          data-testid="attachments-preview"
          className="flex flex-row gap-2 overflow-x-scroll items-end"
        >
          {attachments.map((attachment) => (
            <PreviewAttachment key={attachment.url} attachment={attachment} />
          ))}

          {uploadQueue.map((filename) => (
            <PreviewAttachment
              key={filename}
              attachment={{
                url: '',
                name: filename,
                contentType: '',
              }}
              isUploading={true}
            />
          ))}
        </div>
      )}

      <Textarea
        data-testid="multimodal-input"
        ref={textareaRef}
        placeholder="Send a message..."
        value={input}
        onChange={handleInput}
        className={cx(
          'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl !text-base bg-muted pb-10 dark:border-zinc-700',
          className,
        )}
        rows={2}
        autoFocus
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();

            if (status !== 'ready') {
              toast.error('Please wait for the model to finish its response!');
            } else {
              submitForm();
            }
          }
        }}
      />

      <div className="absolute bottom-0 p-2 w-fit flex flex-row justify-start">
        <AttachmentsButton fileInputRef={fileInputRef} status={status} />
      </div>

      <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end">
        {status === 'submitted' ? (
          <StopButton stop={stop} setMessages={setMessages} />
        ) : (
          <SendButton
            input={input}
            submitForm={submitForm}
            uploadQueue={uploadQueue}
          />
        )}
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.status !== nextProps.status) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;
    // Add checks for new props/state if they affect rendering and are not covered by other checks
    // For this change, existing checks should be mostly fine as new state primarily controls a conditionally rendered component.
    // However, if `messages` prop changes, it might affect `fetchProactiveSuggestions` and thus `proactiveSuggestionsList`.
    // `input` is already checked.
    if (!equal(prevProps.messages, nextProps.messages)) return false;


    return true;
  },
);

function PureAttachmentsButton({
  fileInputRef,
  status,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers['status'];
}) {
  return (
    <Button
      data-testid="attachments-button"
      className="rounded-md rounded-bl-lg p-[7px] h-fit dark:border-zinc-700 hover:dark:bg-zinc-900 hover:bg-zinc-200"
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      disabled={status !== 'ready'}
      variant="ghost"
    >
      <PaperclipIcon size={14} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers['setMessages'];
}) {
  return (
    <Button
      data-testid="stop-button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);

function PureSendButton({
  submitForm,
  input,
  uploadQueue,
}: {
  submitForm: () => void;
  input: string;
  uploadQueue: Array<string>;
}) {
  return (
    <Button
      data-testid="send-button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={input.length === 0 || uploadQueue.length > 0}
    >
      <ArrowUpIcon size={14} />
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.uploadQueue.length !== nextProps.uploadQueue.length)
    return false;
  if (prevProps.input !== nextProps.input) return false;
  return true;
});
