import { motion } from 'framer-motion';

export const Greeting = () => (
  <div
    key="overview"
    className="max-w-3xl mx-auto md:mt-20 px-8 size-full flex flex-col justify-center"
  >
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.5 }}
      className="text-2xl font-semibold"
    >
      Kovu - Your RAG Assistant
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.6 }}
      className="text-2xl text-zinc-500"
    >
      Ask me anything
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.7 }}
      className="mt-4"
    >
      <div className="mt-4 space-y-4 text-zinc-400">
        <div>
          Kovu is a RAG (Retrieval-Augmented Generation) assistant. You can ask
          it questions about your documents, and it will use them to provide
          answers.
        </div>
        <div>
          <h3 className="font-semibold text-zinc-300">To get started:</h3>
          <ul className="list-decimal list-inside mt-2 space-y-1">
            <li>Create an account and log in.</li>

            <li>Upload your documents using the upload button via side bar.</li>
            <li>
              Select the <b>Kovu AI with Tools</b> model from the dropdown.
            </li>
            <li>Ask a question about your documents.</li>
            <li>
              Kovu will search your documents and generate a relevant answer.
            </li>
          </ul>
        </div>
        <div>
          You can also try asking one of the initial questions to learn more
          about how RAG systems work.
        </div>
        <div className="font-semibold text-md text-zinc-300">
          For general questions that don't require document knowledge, try
          switching to the <b>Kovu AI Deep Think</b> model.
        </div>
      </div>
    </motion.div>
  </div>
);
